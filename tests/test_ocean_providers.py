"""
Comprehensive Unit Tests for SolvX Ocean Data Providers & Architecture
======================================================================
Covers:
1. Pydantic Request & Response Models (validation, ranges, types)
2. NOAA ERDDAP Adapter (mock HTTP, parsing, vector currents, error transparency)
3. Copernicus Marine Adapter (mock HTTP, basic auth, parsing, error transparency)
4. HYCOM NCSS Adapter (mock CSV, vector currents, semaphore concurrency, error transparency)
5. GEBCO Bathymetry Adapter (local NetCDF subsetting, downsampling, signed elevation conventions)
6. DataCollector Provider Routing (AUTO mode vs explicit provider error transparency)
7. Central Data API Endpoints
"""

import unittest
from unittest.mock import patch, MagicMock
import json
import math
import numpy as np
from pydantic import ValidationError

from backend.models.requests import (
    BBox,
    OceanVariableRequest,
    BathymetryRequest,
    CombinedRegionRequest,
    OceanVariableResponse,
    OceanCurrentsResponse,
    BathymetryResponse,
    CombinedRegionResponse,
    SUPPORTED_OCEAN_PROVIDERS,
    SUPPORTED_OCEAN_VARIABLES
)
from backend.adapters.noaa_adapter import NOAAAdapter
from backend.adapters.copernicus_adapter import CopernicusAdapter
from backend.adapters.hycom_adapter import HYCOMAdapter
from backend.adapters.bathymetry_adapter import GEBCOAdapter
from backend.services.data_collector import DataCollector, COLLECTOR
from backend.api.data import (
    get_providers as api_get_providers,
    get_providers_status as api_get_providers_status,
    get_provider_variables as api_get_provider_variables,
    get_ocean_data as api_get_ocean_data,
    post_ocean_data as api_post_ocean_data,
    get_combined_region as api_get_combined_region
)
from backend.api.bathymetry import get_bathymetry as api_get_bathymetry


# =============================================================================
# 1. Request and Response Model Tests
# =============================================================================

class TestOceanRequestModels(unittest.TestCase):
    def test_bbox_validation(self):
        # Valid BBox
        bbox = BBox(min_lat=16.0, max_lat=20.0, min_lon=84.0, max_lon=88.0)
        self.assertEqual(bbox.min_lat, 16.0)
        self.assertEqual(bbox.max_lat, 20.0)

        # Inverted latitudes
        with self.assertRaises(ValidationError):
            BBox(min_lat=25.0, max_lat=20.0, min_lon=84.0, max_lon=88.0)

        # Inverted longitudes
        with self.assertRaises(ValidationError):
            BBox(min_lat=16.0, max_lat=20.0, min_lon=90.0, max_lon=88.0)

        # Out of range coordinates
        with self.assertRaises(ValidationError):
            BBox(min_lat=-95.0, max_lat=20.0, min_lon=84.0, max_lon=88.0)

    def test_ocean_variable_request_validation(self):
        valid_bbox = BBox(min_lat=16.0, max_lat=20.0, min_lon=84.0, max_lon=88.0)

        # Valid request with defaults
        req = OceanVariableRequest(bbox=valid_bbox)
        self.assertEqual(req.provider, 'auto')
        self.assertEqual(req.variable, 'temperature')

        # Explicit valid provider and variable
        for prov in SUPPORTED_OCEAN_PROVIDERS:
            req2 = OceanVariableRequest(bbox=valid_bbox, provider=prov, variable='salinity')
            self.assertEqual(req2.provider, prov.lower())

        # Invalid provider
        with self.assertRaises(ValidationError):
            OceanVariableRequest(bbox=valid_bbox, provider='invalid_provider', variable='temperature')

        # Invalid variable
        with self.assertRaises(ValidationError):
            OceanVariableRequest(bbox=valid_bbox, provider='auto', variable='unknown_var_xyz')

    def test_bathymetry_request_validation(self):
        valid_bbox = BBox(min_lat=16.0, max_lat=20.0, min_lon=84.0, max_lon=88.0)

        # Default resolution
        req = BathymetryRequest(bbox=valid_bbox)
        self.assertEqual(req.resolution, 'medium')

        # Valid resolutions
        for res in ['low', 'medium', 'high', 'native']:
            b_req = BathymetryRequest(bbox=valid_bbox, resolution=res)
            self.assertEqual(b_req.resolution, res)

        # Invalid resolution
        with self.assertRaises(ValidationError):
            BathymetryRequest(bbox=valid_bbox, resolution='super_ultra_high')

    def test_combined_region_request(self):
        valid_bbox = BBox(min_lat=16.0, max_lat=20.0, min_lon=84.0, max_lon=88.0)
        req = CombinedRegionRequest(
            bbox=valid_bbox,
            variable='temperature',
            provider='incois',
            include_bathymetry=True,
            resolution='medium'
        )
        self.assertEqual(req.variable, 'temperature')
        self.assertEqual(req.provider, 'incois')
        self.assertTrue(req.include_bathymetry)


# =============================================================================
# 2. NOAA Adapter Tests
# =============================================================================

class TestNOAAAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = NOAAAdapter(timeout=5)

    def test_supported_variables(self):
        vars_list = self.adapter.get_supported_variables()
        self.assertIn('temperature', vars_list)
        self.assertIn('salinity', vars_list)
        self.assertIn('currents', vars_list)
        self.assertIn('sea_surface_height', vars_list)

    def test_build_griddap_url(self):
        url = self.adapter.build_griddap_url(
            dataset_id='ncei_sst',
            variable_name='sst',
            min_lat=16.0,
            max_lat=20.0,
            min_lon=84.0,
            max_lon=88.0,
            stride=2
        )
        self.assertIn('ncei_sst.json', url)
        self.assertIn('sst', url)
        self.assertIn('[(16.0):2:(20.0)]', url)
        self.assertIn('[(84.0):2:(88.0)]', url)

    def test_parse_erddap_scalar(self):
        mock_raw_json = {
            'table': {
                'columnNames': ['time', 'latitude', 'longitude', 'sst'],
                'rows': [
                    ['2026-09-15T00:00:00Z', 16.0, 84.0, 28.5],
                    ['2026-09-15T00:00:00Z', 16.0, 85.0, 28.7],
                    ['2026-09-15T00:00:00Z', 17.0, 84.0, 28.2],
                    ['2026-09-15T00:00:00Z', 17.0, 85.0, 28.4]
                ]
            }
        }
        with patch.object(self.adapter, '_execute_http_query', return_value=mock_raw_json):
            res = self.adapter.fetch_ocean_variable('temperature', 16.0, 17.0, 84.0, 85.0)
            self.assertEqual(res['provider'], 'NOAA')
            self.assertEqual(res['variable'], 'temperature')
            self.assertEqual(len(res['latitude']), 2)
            self.assertEqual(len(res['longitude']), 2)
            self.assertEqual(len(res['values']), 2)
            self.assertEqual(len(res['values'][0]), 2)
            self.assertAlmostEqual(res['values'][0][0], 28.5, places=1)

    def test_parse_erddap_currents(self):
        mock_u = {
            'table': {
                'columnNames': ['time', 'latitude', 'longitude', 'u'],
                'rows': [
                    ['2026-09-15T00:00:00Z', 16.0, 84.0, 0.3],
                    ['2026-09-15T00:00:00Z', 16.0, 85.0, 0.4],
                ]
            }
        }
        mock_v = {
            'table': {
                'columnNames': ['time', 'latitude', 'longitude', 'v'],
                'rows': [
                    ['2026-09-15T00:00:00Z', 16.0, 84.0, 0.4],
                    ['2026-09-15T00:00:00Z', 16.0, 85.0, 0.3],
                ]
            }
        }
        with patch.object(self.adapter, '_execute_http_query', side_effect=[mock_u, mock_v]):
            res = self.adapter.fetch_ocean_variable('currents', 16.0, 16.0, 84.0, 85.0)
            self.assertEqual(res['provider'], 'NOAA')
            self.assertEqual(res['variable'], 'currents')
            self.assertIn('u', res)
            self.assertIn('v', res)
            self.assertIn('speed', res)
            self.assertIn('direction', res)
            # speed for (0.3, 0.4) = sqrt(0.09 + 0.16) = 0.5
            self.assertAlmostEqual(res['speed'][0][0], 0.5, places=2)

    def test_error_transparency(self):
        with patch.object(self.adapter, '_execute_http_query', side_effect=RuntimeError("NOAA ERDDAP HTTP 500: Internal Server Error")):
            with self.assertRaises(RuntimeError) as ctx:
                self.adapter.fetch_ocean_variable('temperature', 16.0, 20.0, 84.0, 88.0)
            self.assertIn("NOAA ERDDAP HTTP 500", str(ctx.exception))


# =============================================================================
# 3. Copernicus Marine Adapter Tests
# =============================================================================

class TestCopernicusAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = CopernicusAdapter(username='test_user', password='test_password', timeout=5)

    def test_supported_variables(self):
        vars_list = self.adapter.get_supported_variables()
        self.assertIn('temperature', vars_list)
        self.assertIn('salinity', vars_list)
        self.assertIn('currents', vars_list)
        self.assertIn('sea_surface_height', vars_list)

    def test_basic_auth_header(self):
        with patch('urllib.request.urlopen') as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.getcode.return_value = 200
            mock_resp.read.return_value = json.dumps({'table': {'columnNames': [], 'rows': []}}).encode('utf-8')
            mock_urlopen.return_value.__enter__.return_value = mock_resp

            try:
                self.adapter._execute_http_query('http://example.com/test')
            except Exception:
                pass

            args, kwargs = mock_urlopen.call_args
            req = args[0]
            self.assertIn('Authorization', req.headers)
            self.assertTrue(req.headers['Authorization'].startswith('Basic '))

    def test_error_transparency(self):
        with patch.object(self.adapter, '_execute_http_query', side_effect=RuntimeError("Copernicus Marine HTTP 401: Unauthorized")):
            with self.assertRaises(RuntimeError) as ctx:
                self.adapter.fetch_ocean_variable('temperature', 16.0, 20.0, 84.0, 88.0)
            self.assertIn("Copernicus Marine HTTP 401", str(ctx.exception))


# =============================================================================
# 4. HYCOM Adapter Tests
# =============================================================================

class TestHYCOMAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = HYCOMAdapter(timeout=5)

    def test_supported_variables(self):
        vars_list = self.adapter.get_supported_variables()
        self.assertIn('temperature', vars_list)
        self.assertIn('salinity', vars_list)
        self.assertIn('currents', vars_list)
        self.assertIn('sea_surface_height', vars_list)

    def test_semaphore_rate_limiting(self):
        self.assertEqual(self.adapter._semaphore._value, 2)

    def test_parse_ncss_scalar_csv(self):
        mock_csv = """time,latitude,longitude,water_temp
2026-09-15T00:00:00Z,16.0,84.0,29.1
2026-09-15T00:00:00Z,16.0,85.0,29.3
2026-09-15T00:00:00Z,17.0,84.0,28.9
2026-09-15T00:00:00Z,17.0,85.0,29.0
"""
        with patch.object(self.adapter, '_execute_http_query', return_value=mock_csv):
            res = self.adapter.fetch_ocean_variable('temperature', 16.0, 17.0, 84.0, 85.0)
            self.assertEqual(res['provider'], 'HYCOM')
            self.assertEqual(res['variable'], 'temperature')
            self.assertEqual(len(res['latitude']), 2)
            self.assertEqual(len(res['longitude']), 2)
            self.assertEqual(len(res['values']), 2)
            self.assertAlmostEqual(res['values'][0][0], 29.1, places=1)

    def test_parse_ncss_currents_csv(self):
        u_csv = """time,latitude,longitude,water_u
2026-09-15T00:00:00Z,16.0,84.0,0.6
2026-09-15T00:00:00Z,16.0,85.0,0.8
"""
        v_csv = """time,latitude,longitude,water_v
2026-09-15T00:00:00Z,16.0,84.0,0.8
2026-09-15T00:00:00Z,16.0,85.0,0.6
"""
        with patch.object(self.adapter, '_execute_http_query', side_effect=[u_csv, v_csv]):
            res = self.adapter.fetch_ocean_variable('currents', 16.0, 16.0, 84.0, 85.0)
            self.assertEqual(res['provider'], 'HYCOM')
            self.assertEqual(res['variable'], 'currents')
            self.assertIn('u', res)
            self.assertIn('v', res)
            self.assertIn('speed', res)
            self.assertIn('direction', res)
            self.assertAlmostEqual(res['speed'][0][0], 1.0, places=2)

    def test_empty_csv_error_transparency(self):
        with patch.object(self.adapter, '_execute_http_query', return_value=""):
            with self.assertRaises(RuntimeError) as ctx:
                self.adapter.fetch_ocean_variable('temperature', 16.0, 20.0, 84.0, 88.0)
            self.assertIn("Empty data returned", str(ctx.exception))


# =============================================================================
# 5. GEBCO Bathymetry Adapter Tests
# =============================================================================

class TestGEBCOAdapter(unittest.TestCase):
    def setUp(self):
        self.adapter = GEBCOAdapter()

    def test_metadata(self):
        meta = self.adapter.get_metadata()
        self.assertEqual(meta['provider'], 'GEBCO')
        self.assertEqual(meta['dataset'], 'GEBCO 2026 Grid')
        self.assertIn('elevation', meta['convention'])
        self.assertIn('meters', meta['units'])

    def test_fetch_bathymetry_local_netcdf(self):
        data = self.adapter.fetch_bathymetry(
            min_lat=17.0,
            max_lat=19.0,
            min_lon=86.0,
            max_lon=88.0,
            resolution='low'
        )
        self.assertIsNotNone(data)
        self.assertEqual(data['provider'], 'GEBCO')
        self.assertIn('elevation', data)
        self.assertIn('depth', data)
        self.assertIn('rawDepthKm', data)
        self.assertIn('maxDepthKm', data)
        self.assertIn('x', data)
        self.assertIn('y', data)

        elevations = [v for row in data['elevation'] for v in row if v is not None]
        has_negative = any(v < 0 for v in elevations)
        self.assertTrue(has_negative, "Expected negative elevation values for ocean bathymetry")

        raw_depths = [v for row in data['rawDepthKm'] for v in row if v is not None]
        has_positive_depth = any(v > 0 for v in raw_depths)
        self.assertTrue(has_positive_depth, "Expected positive rawDepthKm values")

    def test_resolution_downsampling(self):
        low = self.adapter.fetch_bathymetry(17.0, 19.0, 86.0, 88.0, resolution='low')
        med = self.adapter.fetch_bathymetry(17.0, 19.0, 86.0, 88.0, resolution='medium')

        self.assertIsNotNone(low)
        self.assertIsNotNone(med)
        ny_low, nx_low = len(low['elevation']), len(low['elevation'][0])
        ny_med, nx_med = len(med['elevation']), len(med['elevation'][0])
        self.assertGreaterEqual(ny_med * nx_med, ny_low * nx_low)


# =============================================================================
# 6. DataCollector Routing & Error Transparency Tests
# =============================================================================

class TestDataCollectorProviderRouting(unittest.TestCase):
    def test_provider_registry(self):
        providers = COLLECTOR.get_providers()
        self.assertIsInstance(providers, list)
        prov_ids = {p['id'] for p in providers}
        self.assertIn('incois', prov_ids)
        self.assertIn('copernicus', prov_ids)
        self.assertIn('noaa', prov_ids)
        self.assertIn('hycom', prov_ids)

    def test_provider_status(self):
        status = COLLECTOR.get_provider_status()
        self.assertIn('gebco', status)
        self.assertIn('incois', status)
        self.assertIn('noaa', status)
        self.assertIn('copernicus', status)
        self.assertIn('hycom', status)

    def test_auto_provider_selection(self):
        res = COLLECTOR.get_ocean_data(
            provider='auto',
            variable='temperature',
            min_lat=17.0,
            max_lat=19.0,
            min_lon=85.0,
            max_lon=87.0
        )
        self.assertEqual(res['requested_provider'], 'auto')
        self.assertIn(res['provider'].lower(), ['incois', 'local', 'noaa', 'copernicus', 'hycom'])

    def test_explicit_provider_error_transparency(self):
        with patch.object(COLLECTOR.noaa, 'fetch_ocean_variable', side_effect=RuntimeError("Explicit NOAA Outage")):
            with self.assertRaises(RuntimeError) as ctx:
                COLLECTOR.get_ocean_data(
                    provider='noaa',
                    variable='temperature',
                    min_lat=17.0,
                    max_lat=19.0,
                    min_lon=85.0,
                    max_lon=87.0
                )
            self.assertIn("Explicit NOAA Outage", str(ctx.exception))

    def test_combined_region(self):
        res = COLLECTOR.get_combined_region(
            variable='temperature',
            provider='auto',
            min_lat=17.0,
            max_lat=19.0,
            min_lon=85.0,
            max_lon=87.0,
            include_bathymetry=True
        )
        self.assertIn('ocean', res)
        self.assertIn('bathymetry', res)
        self.assertIn('region', res)
        self.assertIn('metadata', res)
        self.assertEqual(res['bathymetry']['provider'], 'GEBCO')


# =============================================================================
# 7. Central Data API Endpoints Tests
# =============================================================================

class TestCentralDataAPI(unittest.TestCase):
    def test_api_providers_endpoint(self):
        data = api_get_providers()
        self.assertIsInstance(data, list)
        prov_ids = {p['id'] for p in data}
        self.assertIn('noaa', prov_ids)

    def test_api_providers_status_endpoint(self):
        status = api_get_providers_status()
        self.assertIn('gebco', status)
        self.assertIn('noaa', status)

    def test_api_provider_variables_endpoint(self):
        noaa_vars = api_get_provider_variables('noaa')
        self.assertIsInstance(noaa_vars, list)
        self.assertIn('temperature', noaa_vars)

    def test_api_ocean_get(self):
        res = api_get_ocean_data(
            provider='auto',
            variable='temperature',
            min_lat=17.0,
            max_lat=19.0,
            min_lon=85.0,
            max_lon=87.0
        )
        self.assertIn('values', res)
        self.assertIn('latitude', res)
        self.assertIn('longitude', res)

    def test_api_ocean_post(self):
        req = OceanVariableRequest(
            provider='auto',
            variable='temperature',
            bbox=BBox(min_lat=17.0, max_lat=19.0, min_lon=85.0, max_lon=87.0)
        )
        res = api_post_ocean_data(req)
        self.assertIn('values', res)

    def test_api_bathymetry(self):
        bathy = api_get_bathymetry(
            min_lat=17.0,
            max_lat=19.0,
            min_lon=85.0,
            max_lon=87.0,
            resolution='low'
        )
        self.assertEqual(bathy['provider'], 'GEBCO')
        self.assertIn('elevation', bathy)
        self.assertIn('depth', bathy)


if __name__ == '__main__':
    unittest.main()
