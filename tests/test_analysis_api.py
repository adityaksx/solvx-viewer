"""
Automated tests for Stage 4: Oceanographic Analysis Engine
=========================================================
Tests Model vs Argo collocated vertical profile comparisons, statistical metrics
(RMSE, Bias, MAE), observation coverage, configurable density grids, and gap detection.
"""

import math
import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_regional_model_vs_argo_temperature():
    """Verify regional Model vs Argo temperature evaluation across active floats."""
    resp = client.get('/api/analysis/model-vs-argo?variable=temperature')
    assert resp.status_code == 200
    data = resp.json()

    assert data['variable'] == 'temperature'
    assert data['floats_compared'] > 0
    assert data['total_sounding_points'] > 0
    assert data['overall_rmse'] is not None
    assert data['overall_rmse'] > 0
    assert data['overall_bias'] is not None
    assert data['overall_mae'] is not None

    # Ranking should be sorted by RMSE descending
    ranking = data['discrepancy_ranking']
    assert len(ranking) == data['floats_compared']
    for i in range(len(ranking) - 1):
        assert ranking[i]['rmse'] >= ranking[i + 1]['rmse']


def test_regional_model_vs_argo_salinity():
    """Verify regional Model vs Argo salinity evaluation."""
    resp = client.get('/api/analysis/model-vs-argo?variable=salinity')
    assert resp.status_code == 200
    data = resp.json()
    assert data['variable'] == 'salinity'
    assert data['floats_compared'] > 0
    assert data['overall_rmse'] is not None


def test_single_float_model_vs_argo():
    """Verify single float collocated vertical profile evaluation with bilinear interpolation."""
    resp = client.get('/api/analysis/model-vs-argo/2902694?variable=temperature')
    assert resp.status_code == 200
    data = resp.json()

    assert data['float_id'] == '2902694'
    assert data['wmo'] == 2902694
    assert data['points_count'] > 0
    assert len(data['comparison']) == data['points_count']
    assert data['rmse'] is not None
    assert data['bias'] is not None
    assert data['mae'] is not None

    # Verify math consistency: diff = observed - model, abs_diff = abs(diff)
    diffs = []
    for pt in data['comparison']:
        expected_diff = round(pt['observed'] - pt['model'], 3)
        assert math.isclose(pt['diff'], expected_diff, abs_tol=0.01)
        assert math.isclose(pt['abs_diff'], abs(expected_diff), abs_tol=0.01)
        diffs.append(pt['diff'])

    # Verify RMSE math
    manual_rmse = math.sqrt(sum(d ** 2 for d in diffs) / len(diffs))
    assert math.isclose(data['rmse'], manual_rmse, abs_tol=0.01)

    # Verify Mean Bias math
    manual_bias = sum(diffs) / len(diffs)
    assert math.isclose(data['bias'], manual_bias, abs_tol=0.01)


def test_float_model_vs_argo_not_found():
    """Verify 404 for non-existent float."""
    resp = client.get('/api/analysis/model-vs-argo/9999999')
    assert resp.status_code == 404


def test_observation_coverage_analysis():
    """Verify spatial grid density, strata coverage, and temporal distribution."""
    resp = client.get('/api/analysis/coverage?grid_res_deg=1.0&thresh_high=10&thresh_med=3&thresh_low=1')
    assert resp.status_code == 200
    data = resp.json()

    assert data['total_observations'] > 0
    assert data['active_floats_count'] > 0
    assert 0 <= data['spatial_coverage_pct'] <= 100
    assert 'density_summary' in data
    assert 'HIGH' in data['density_summary']
    assert 'NONE' in data['density_summary']

    # Depth strata must cover ocean layers
    strata = data['depth_strata_coverage']
    assert len(strata) >= 4
    for layer in strata:
        assert 'layer_name' in layer
        assert 'status' in layer
        assert layer['status'] in ('SUFFICIENT', 'MODERATE', 'SPARSE')

    # Grid cells must be present
    assert len(data['grid_cells']) > 0
    cell = data['grid_cells'][0]
    assert 'center_lat' in cell
    assert 'center_lon' in cell
    assert cell['density_class'] in ('HIGH', 'MEDIUM', 'LOW', 'NONE')


def test_observation_data_gaps_detection():
    """Verify detection of unmonitored sectors and depth gaps with configurable thresholds."""
    resp = client.get('/api/analysis/gaps?grid_res_deg=1.5&thresh_high=12&thresh_med=4&thresh_low=1')
    assert resp.status_code == 200
    data = resp.json()

    assert data['total_cells'] > 0
    assert data['empty_cells_count'] + data['monitored_cells'] == data['total_cells']
    assert 0 <= data['gap_percentage'] <= 100
    assert isinstance(data['gap_regions'], list)
    assert len(data['gap_regions']) > 0

    for gap in data['gap_regions']:
        assert gap['severity'] in ('CRITICAL', 'MODERATE', 'LOW')
        assert 'min_lat' in gap['bbox']
        assert len(gap['recommendation']) > 0


def test_executive_analysis_summary():
    """Verify comprehensive executive summary report."""
    resp = client.get('/api/analysis/summary?variable=temperature')
    assert resp.status_code == 200
    data = resp.json()

    assert data['status'] == 'READY'
    assert 'model_accuracy' in data
    assert 'overall_rmse' in data['model_accuracy']
    assert 'observation_coverage' in data
    assert 'data_gaps' in data
    assert data['data_gaps']['gap_percentage'] > 0


def test_metric_definitions():
    """Verify metric definitions endpoint returns clear descriptions and units."""
    resp = client.get('/api/analysis/definitions')
    assert resp.status_code == 200
    data = resp.json()
    assert 'definitions' in data
    assert 'rmse' in data['definitions']
    assert 'bias' in data['definitions']
    assert 'z_score' in data['definitions']
    assert 'standard_units' in data
    assert data['standard_units']['temperature'] == '°C'
    assert data['standard_units']['salinity'] == 'PSU'


def test_analysis_units_and_metadata():
    """Verify units and metadata are present across comparison and anomaly endpoints."""
    # 1. Model vs Argo
    resp_argo = client.get('/api/analysis/model-vs-argo?variable=temperature')
    assert resp_argo.status_code == 200
    d_argo = resp_argo.json()
    assert d_argo['unit'] == '°C'
    assert 'metadata' in d_argo
    assert d_argo['float_comparisons'][0]['unit'] == '°C'

    # 2. Anomalies
    resp_anom = client.get('/api/analysis/anomalies?variable=temperature&method=zscore')
    assert resp_anom.status_code == 200
    d_anom = resp_anom.json()
    assert d_anom['unit'] == '°C'
    assert 'metadata' in d_anom

    # 3. Abnormal regions
    resp_reg = client.get('/api/analysis/abnormal-regions?variable=temperature')
    assert resp_reg.status_code == 200
    d_reg = resp_reg.json()
    assert d_reg['unit'] == '°C'
    assert 'metadata' in d_reg
