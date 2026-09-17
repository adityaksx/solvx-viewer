import unittest
import math
import json
from unittest.mock import patch, MagicMock
import numpy as np

from backend.models.requests import BBox
from backend.services.data_collector import COLLECTOR, DataCollector
from backend.adapters.incois_adapter import INCOISAdapter, INCOIS_VARIABLE_MAP
from backend.adapters.bathymetry_adapter import BathymetryAdapter
from backend.adapters.geography_adapter import GeographyAdapter
from backend.adapters.observation_adapter import ObservationAdapter
from backend.processing.normalization import sanitize
from backend.services.cache_service import GLOBAL_CACHE


class TestSolvXDataCollector(unittest.TestCase):
    def setUp(self):
        GLOBAL_CACHE.clear()

    def test_bbox_validation(self):
        # Valid bbox
        bbox = BBox(min_lat=10.0, max_lat=20.0, min_lon=80.0, max_lon=90.0)
        self.assertEqual(bbox.min_lat, 10.0)
        self.assertEqual(bbox.area_deg2, 100.0)

        # Invalid bounds: min >= max
        with self.assertRaises(ValueError):
            BBox(min_lat=20.0, max_lat=10.0, min_lon=80.0, max_lon=90.0)
        with self.assertRaises(ValueError):
            BBox(min_lat=10.0, max_lat=20.0, min_lon=90.0, max_lon=80.0)

        # Invalid coordinates out of range
        with self.assertRaises(ValueError):
            BBox(min_lat=-95.0, max_lat=20.0, min_lon=80.0, max_lon=90.0)
        with self.assertRaises(ValueError):
            BBox(min_lat=10.0, max_lat=20.0, min_lon=-190.0, max_lon=90.0)

    def test_variables_catalog(self):
        cat = COLLECTOR.get_variables_catalog()
        self.assertIn('variables', cat)
        self.assertGreater(cat['count'], 0)
        var_ids = {v['id'] for v in cat['variables']}
        self.assertIn('temperature', var_ids)
        self.assertIn('salinity', var_ids)
        self.assertIn('currents', var_ids)
        self.assertIn('sea_surface_height', var_ids)
        self.assertIn('mixed_layer_depth', var_ids)

    def test_incois_url_construction(self):
        adapter = INCOISAdapter(base_url='https://erddap.incois.gov.in/erddap')
        url = adapter.build_griddap_url(
            dataset_id='incois_hoofs_temp',
            variable_name='temperature',
            min_lat=15.0,
            max_lat=20.0,
            min_lon=85.0,
            max_lon=90.0,
            depth=50.0,
            time='2024-05-15T00:00:00Z'
        )
        self.assertTrue(url.startswith('https://erddap.incois.gov.in/erddap/griddap/incois_hoofs_temp.json?'))
        self.assertIn('temperature', url)
        self.assertIn('(2024-05-15T00:00:00Z)', url)
        self.assertIn('(50.0)', url)
        self.assertIn('(15.0):(20.0)', url)
        self.assertIn('(85.0):(90.0)', url)

    def test_incois_erddap_scalar_parsing(self):
        adapter = INCOISAdapter()
        mock_erddap_json = {
            'table': {
                'columnNames': ['time', 'depth', 'latitude', 'longitude', 'temperature'],
                'rows': [
                    ['2024-05-15T00:00:00Z', 0.0, 15.0, 85.0, 29.5],
                    ['2024-05-15T00:00:00Z', 0.0, 15.0, 90.0, 29.8],
                    ['2024-05-15T00:00:00Z', 0.0, 20.0, 85.0, 28.9],
                    ['2024-05-15T00:00:00Z', 0.0, 20.0, 90.0, 29.1]
                ]
            }
        }
        res = adapter._parse_erddap_scalar(
            raw_json=mock_erddap_json,
            variable='temperature',
            var_config=INCOIS_VARIABLE_MAP['temperature'],
            min_lat=15.0,
            max_lat=20.0,
            min_lon=85.0,
            max_lon=90.0,
            depth=0.0,
            time='2024-05-15T00:00:00Z'
        )
        self.assertEqual(res['variable'], 'temperature')
        self.assertEqual(res['latitude'], [15.0, 20.0])
        self.assertEqual(res['longitude'], [85.0, 90.0])
        self.assertEqual(len(res['values']), 2)
        self.assertEqual(len(res['values'][0]), 2)
        self.assertEqual(res['values'][0][0], 29.5)

    def test_current_vector_normalization(self):
        adapter = INCOISAdapter()
        mock_u = {
            'table': {
                'columnNames': ['time', 'depth', 'latitude', 'longitude', 'uo'],
                'rows': [
                    ['2024-05-15T00:00:00Z', 0.0, 15.0, 85.0, 0.3],
                    ['2024-05-15T00:00:00Z', 0.0, 15.0, 90.0, -0.4]
                ]
            }
        }
        mock_v = {
            'table': {
                'columnNames': ['time', 'depth', 'latitude', 'longitude', 'vo'],
                'rows': [
                    ['2024-05-15T00:00:00Z', 0.0, 15.0, 85.0, 0.4],
                    ['2024-05-15T00:00:00Z', 0.0, 15.0, 90.0, 0.3]
                ]
            }
        }
        res = adapter._parse_erddap_currents(
            u_json=mock_u,
            v_json=mock_v,
            min_lat=15.0,
            max_lat=15.0,
            min_lon=85.0,
            max_lon=90.0,
            depth=0.0,
            time='2024-05-15T00:00:00Z'
        )
        self.assertEqual(res['variable'], 'currents')
        # Point 1: u=0.3, v=0.4 => speed = 0.5, direction = atan2(0.4, 0.3) deg ≈ 53.13 deg
        self.assertAlmostEqual(res['speed'][0][0], 0.5, places=3)
        self.assertAlmostEqual(res['direction'][0][0], 53.13, places=1)
        # Point 2: u=-0.4, v=0.3 => speed = 0.5, direction = atan2(0.3, -0.4) deg ≈ 143.13 deg
        self.assertAlmostEqual(res['speed'][0][1], 0.5, places=3)
        self.assertAlmostEqual(res['direction'][0][1], 143.13, places=1)

    def test_ocean_variable_fetch(self):
        # Test temperature
        temp_res = COLLECTOR.get_ocean_variable('temperature', min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertEqual(temp_res['variable'], 'temperature')
        self.assertIn('values', temp_res)
        self.assertGreater(len(temp_res['values']), 0)

        # Test currents
        curr_res = COLLECTOR.get_ocean_variable('currents', min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertEqual(curr_res['variable'], 'currents')
        self.assertIn('u', curr_res)
        self.assertIn('v', curr_res)
        self.assertIn('speed', curr_res)
        self.assertIn('direction', curr_res)

    def test_bathymetry_fetch(self):
        bathy = COLLECTOR.get_bathymetry(min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertIn('depth', bathy)
        self.assertIn('x', bathy)
        self.assertIn('y', bathy)
        self.assertIn('rawDepthKm', bathy)
        self.assertIn('maxDepthKm', bathy)
        self.assertGreater(len(bathy['rawDepthKm']), 0)

    def test_geography_and_coastline_fetch(self):
        geo = COLLECTOR.get_geometry(min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertIn('land', geo)
        self.assertIn('coast', geo)
        self.assertGreater(len(geo['land']), 0)
        self.assertGreater(len(geo['coast']), 0)

        coast = COLLECTOR.get_coastline(min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertIn('coast', coast)
        self.assertIn('eezBeads', coast)

    def test_observations_and_comparison(self):
        obs = COLLECTOR.get_observations(min_lat=10.0, max_lat=24.0, min_lon=80.0, max_lon=95.0)
        self.assertGreater(obs['count'], 0)
        first_obs = obs['observations'][0]
        self.assertIn('wmo', first_obs)
        self.assertIn('profile', first_obs)

        cmp = COLLECTOR.get_observation_comparison(first_obs['id'])
        self.assertIn('comparison', cmp)
        self.assertIn('rmse', cmp)
        self.assertIn('bias', cmp)

    def test_cache_behavior(self):
        # First call hits service/file
        res1 = COLLECTOR.get_ocean_variable('temperature', min_lat=18.0, max_lat=20.0, min_lon=88.0, max_lon=90.0)
        # Second call hits cache
        res2 = COLLECTOR.get_ocean_variable('temperature', min_lat=18.0, max_lat=20.0, min_lon=88.0, max_lon=90.0)
        self.assertEqual(res1, res2)

    def test_error_handling_unsupported_variable(self):
        with self.assertRaises(ValueError):
            COLLECTOR.get_ocean_variable('non_existent_var', min_lat=10.0, max_lat=20.0, min_lon=80.0, max_lon=90.0)

    def test_error_handling_max_area(self):
        # Query spanning 30x30 = 900 deg^2 (exceeds default MAX_REQUEST_AREA_DEG2 = 400 deg^2)
        with self.assertRaises(ValueError) as ctx:
            COLLECTOR.get_ocean_variable('temperature', min_lat=0.0, max_lat=30.0, min_lon=60.0, max_lon=90.0)
        self.assertIn('exceeds maximum allowed limit', str(ctx.exception))

    def test_variable_timeline(self):
        tl_temp = COLLECTOR.get_timeline('temperature', min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertEqual(tl_temp['variable'], 'temperature')
        self.assertIn('available_timestamps', tl_temp)
        self.assertGreater(len(tl_temp['available_timestamps']), 0)
        self.assertEqual(tl_temp['default_resolution'], 'daily')
        self.assertIn('daily', tl_temp['resolutions'])
        self.assertIn('depth_levels', tl_temp)

        tl_ssh = COLLECTOR.get_timeline('sea_surface_height', min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertEqual(tl_ssh['variable'], 'sea_surface_height')
        self.assertEqual(tl_ssh['default_resolution'], 'hourly')
        self.assertGreater(len(tl_ssh['available_timestamps']), 100)

    def test_eez_fetch(self):
        eez_data = COLLECTOR.get_eez(min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        self.assertEqual(eez_data['type'], 'FeatureCollection')
        self.assertIn('features', eez_data)
        self.assertIn('lines3d', eez_data)
        self.assertIn('source', eez_data)
        self.assertGreater(len(eez_data['features']), 0)
        self.assertGreater(len(eez_data['lines3d']), 0)

    def test_geography_islands_and_eez(self):
        geo = COLLECTOR.get_geometry(min_lat=11.0, max_lat=15.0, min_lon=92.0, max_lon=94.0)
        self.assertIn('islands', geo)
        self.assertIn('eezBeads', geo)
        self.assertGreater(len(geo['islands']), 0)
        self.assertGreater(len(geo['eezBeads']), 0)

    def test_structured_provenance(self):
        res = COLLECTOR.get_ocean_variable('temperature', min_lat=16.07, max_lat=23.52, min_lon=84.1, max_lon=93.0)
        source = res.get('source')
        self.assertIsInstance(source, dict)
        self.assertEqual(source.get('provider'), 'INCOIS')
        self.assertEqual(source.get('dataset'), 'incois_hoofs_temp')
        self.assertIn('mode', source)
        self.assertIn('retrieved_at', source)


if __name__ == '__main__':
    unittest.main()
