"""
SolvX — Stage 5 Intelligence API Tests
=======================================
Tests for anomaly detection and abnormal region extraction endpoints.
Verifies: structure, required fields, all detection methods, focus commands.
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Anomaly Detection
# ---------------------------------------------------------------------------

class TestAnomalyDetection:

    def test_anomaly_detection_zscore(self):
        """z-score method returns valid AnomalyDetectionResponse structure."""
        resp = client.get('/api/analysis/anomalies?variable=temperature&method=zscore&threshold_sigma=2.0')
        assert resp.status_code == 200
        data = resp.json()
        assert data['variable'] == 'temperature'
        assert data['method'] == 'zscore'
        assert data['threshold_sigma'] == pytest.approx(2.0)
        assert isinstance(data['floats_scanned'], int) and data['floats_scanned'] > 0
        assert isinstance(data['total_depth_levels'], int) and data['total_depth_levels'] > 0
        assert isinstance(data['anomaly_count'], int) and data['anomaly_count'] >= 0
        assert isinstance(data['anomalies'], list)

    def test_anomaly_detection_model_observation(self):
        """model_observation method returns valid structure and anomaly records."""
        resp = client.get('/api/analysis/anomalies?variable=temperature&method=model_observation&threshold_abs=1.5')
        assert resp.status_code == 200
        data = resp.json()
        assert data['method'] == 'model_observation'
        assert data['threshold_abs'] == pytest.approx(1.5)
        assert isinstance(data['anomalies'], list)

    def test_anomaly_detection_threshold(self):
        """threshold method returns valid structure."""
        resp = client.get('/api/analysis/anomalies?variable=salinity&method=threshold&threshold_abs=1.0')
        assert resp.status_code == 200
        data = resp.json()
        assert data['variable'] == 'salinity'
        assert data['method'] == 'threshold'

    def test_anomaly_detection_local_deviation(self):
        """local_deviation method returns valid structure."""
        resp = client.get('/api/analysis/anomalies?variable=temperature&method=local_deviation&threshold_abs=2.0')
        assert resp.status_code == 200
        data = resp.json()
        assert data['method'] == 'local_deviation'
        assert isinstance(data['anomalies'], list)

    def test_anomaly_record_required_fields(self):
        """Every AnomalyRecord must contain all required scientific fields."""
        resp = client.get('/api/analysis/anomalies?variable=temperature&method=zscore&threshold_sigma=1.0')
        assert resp.status_code == 200
        data = resp.json()
        required = {'variable', 'float_id', 'wmo', 'latitude', 'longitude',
                    'depth', 'time', 'value', 'baseline', 'difference',
                    'abs_difference', 'detection_method', 'severity'}
        for rec in data['anomalies']:
            missing = required - set(rec.keys())
            assert not missing, f"AnomalyRecord missing fields: {missing}"
            # detection_method must be recorded — plan.md rule: never flag without stating why
            assert rec['detection_method'] in ('zscore', 'threshold', 'model_observation', 'local_deviation')
            assert rec['severity'] in ('HIGH', 'MODERATE', 'LOW')
            # baseline must be a real number (not null)
            assert isinstance(rec['baseline'], (int, float))
            assert isinstance(rec['difference'], (int, float))

    def test_anomaly_invalid_method_rejected(self):
        """Unknown detection method returns HTTP 400."""
        resp = client.get('/api/analysis/anomalies?method=neural_network')
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Abnormal Region Extraction
# ---------------------------------------------------------------------------

class TestAbnormalRegions:

    def test_abnormal_regions_basic(self):
        """Returns valid AbnormalRegionResponse structure."""
        resp = client.get('/api/analysis/abnormal-regions?variable=temperature&method=zscore')
        assert resp.status_code == 200
        data = resp.json()
        assert data['variable'] == 'temperature'
        assert data['method'] == 'zscore'
        assert isinstance(data['region_count'], int)
        assert data['region_count'] == len(data['regions'])
        assert isinstance(data['regions'], list)

    def test_abnormal_regions_focus_commands(self):
        """Every AbnormalRegion must have a complete FOCUS_REGION FocusCommand."""
        resp = client.get('/api/analysis/abnormal-regions?variable=temperature&method=zscore&threshold_sigma=1.0')
        assert resp.status_code == 200
        data = resp.json()
        for region in data['regions']:
            fc = region.get('focus_command', {})
            assert fc.get('action') == 'FOCUS_REGION', f"Region {region['id']} missing FOCUS_REGION action"
            assert isinstance(fc.get('lat'), float)
            assert isinstance(fc.get('lon'), float)
            assert isinstance(fc.get('depth'), float)
            assert fc.get('variable') == 'temperature'
            assert fc.get('layer') == 'anomaly'

    def test_abnormal_regions_bbox_structure(self):
        """Every AbnormalRegion must have a bbox with min/max lat/lon and a depth_range_m."""
        resp = client.get('/api/analysis/abnormal-regions?variable=temperature&method=zscore&threshold_sigma=1.0')
        assert resp.status_code == 200
        data = resp.json()
        for region in data['regions']:
            bbox = region.get('bbox', {})
            assert 'min_lat' in bbox
            assert 'max_lat' in bbox
            assert 'min_lon' in bbox
            assert 'max_lon' in bbox
            assert len(region.get('depth_range_m', [])) == 2
            assert region.get('anomaly_count', 0) > 0
            assert region.get('severity') in ('CRITICAL', 'MODERATE', 'LOW')

    def test_abnormal_regions_sorted_by_severity(self):
        """CRITICAL regions must come before MODERATE and LOW (severity sort)."""
        resp = client.get('/api/analysis/abnormal-regions?variable=temperature&method=zscore&threshold_sigma=1.0')
        assert resp.status_code == 200
        data = resp.json()
        order = {'CRITICAL': 0, 'MODERATE': 1, 'LOW': 2}
        sev_order = [order[r['severity']] for r in data['regions']]
        assert sev_order == sorted(sev_order), "Regions are not sorted by severity (CRITICAL first)"

    def test_dashboard_data_complete(self):
        """Summary, anomalies, and regions all return 200 (full dashboard data load)."""
        summary_resp  = client.get('/api/analysis/summary?variable=temperature')
        anomaly_resp  = client.get('/api/analysis/anomalies?variable=temperature&method=zscore')
        regions_resp  = client.get('/api/analysis/abnormal-regions?variable=temperature&method=zscore')
        coverage_resp = client.get('/api/analysis/coverage')
        gaps_resp     = client.get('/api/analysis/gaps')

        assert summary_resp.status_code  == 200
        assert anomaly_resp.status_code  == 200
        assert regions_resp.status_code  == 200
        assert coverage_resp.status_code == 200
        assert gaps_resp.status_code     == 200
