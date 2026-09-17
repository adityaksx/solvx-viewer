import unittest
import threading
import numpy as np

from backend.main import (
    root,
    health,
    legacy_ocean_catalog,
    legacy_ocean_time,
    legacy_ocean_current_grid,
    legacy_ocean_point,
    legacy_ocean_observations,
    legacy_datasets,
    legacy_variables,
    legacy_metadata
)
from backend.api.region import get_presets, validate_region
from backend.models.requests import BBox
from backend.api.geography import get_geography
from backend.api.bathymetry import get_bathymetry
from backend.api.ocean import (
    ocean_catalog,
    ocean_time,
    ocean_current_grid,
    ocean_point,
    ocean_region_array
)
from backend.api.observations import (
    list_observations,
    compare_observation
)
from backend.services.cache_service import NETCDF_LOCK, safe_open_dataset
from backend.processing.normalization import sanitize


class TestSolvXBackend(unittest.TestCase):
    def test_root_and_health(self):
        r = root()
        self.assertEqual(r['name'], 'SolvX Ocean Data API')
        self.assertEqual(r['status'], 'running')
        self.assertIn('endpoints', r)
        self.assertIn('region', r['endpoints'])

        h = health()
        self.assertEqual(h['status'], 'healthy')

    def test_region_presets_and_validation(self):
        presets = get_presets()
        self.assertIn('presets', presets)
        preset_ids = {p['id'] for p in presets['presets']}
        self.assertIn('bay_of_bengal', preset_ids)
        bob = next(p for p in presets['presets'] if p['id'] == 'bay_of_bengal')
        self.assertEqual(bob['name'], 'Bay of Bengal')
        self.assertEqual(bob['bbox']['min_lon'], 84.1)

        # Valid bbox validation
        val = validate_region(BBox(min_lon=80.0, max_lon=95.0, min_lat=10.0, max_lat=23.0))
        self.assertTrue(val['valid'])
        self.assertEqual(val['bbox']['min_lon'], 80.0)

        # Invalid bbox tests (Pydantic validation errors)
        with self.assertRaises(Exception):
            BBox(min_lon=95.0, max_lon=80.0, min_lat=10.0, max_lat=23.0)
        with self.assertRaises(Exception):
            BBox(min_lon=80.0, max_lon=95.0, min_lat=100.0, max_lat=23.0)

    def test_geography_service(self):
        geo = get_geography(min_lon=84.1, max_lon=93.0, min_lat=16.07, max_lat=23.52)
        self.assertIn('land', geo)
        self.assertIn('coast', geo)
        self.assertIn('bounds', geo)
        self.assertIsInstance(geo['land'], list)
        self.assertIsInstance(geo['coast'], list)
        self.assertGreater(len(geo['land']), 0)
        self.assertGreater(len(geo['coast']), 0)

    def test_bathymetry_service(self):
        bathy = get_bathymetry(min_lon=84.1, max_lon=93.0, min_lat=16.07, max_lat=23.52)
        self.assertIn('bounds', bathy)
        self.assertIn('terrain', bathy)
        terrain = bathy['terrain']
        self.assertIn('x', terrain)
        self.assertIn('y', terrain)
        self.assertIn('rawDepthKm', terrain)
        self.assertIn('maxDepthKm', terrain)
        self.assertGreater(len(terrain['rawDepthKm']), 0)

    def test_ocean_catalog(self):
        cat = ocean_catalog()
        self.assertIn('variables', cat)
        var_ids = {v['id'] for v in cat['variables']}
        self.assertIn('temperature', var_ids)
        self.assertIn('salinity', var_ids)
        self.assertIn('currents', var_ids)
        self.assertIn('sea_level', var_ids)

    def test_ocean_time(self):
        t = ocean_time()
        self.assertGreater(t['count'], 0)
        self.assertEqual(len(t['values']), t['count'])

    def test_ocean_current_grid(self):
        cg = ocean_current_grid(stride=4)
        self.assertIn('u', cg)
        self.assertIn('v', cg)
        self.assertIn('latitude', cg)
        self.assertIn('longitude', cg)
        self.assertEqual(len(cg['u']), len(cg['latitude']))
        self.assertEqual(len(cg['u'][0]), len(cg['longitude']))

    def test_ocean_point_bay_of_bengal(self):
        p = ocean_point(latitude=19.5, longitude=88.5)
        self.assertEqual(p['latitude'], 19.5)
        self.assertEqual(p['longitude'], 88.5)
        val_map = {v['id']: v for v in p['values']}

        # Temperature in Bay of Bengal is typically 20-35 C
        temp = val_map['temperature']['value']
        self.assertIsNotNone(temp)
        self.assertGreater(temp, 20.0)
        self.assertLess(temp, 35.0)

        # Salinity in Bay of Bengal is typically 20-40 PSU
        sal = val_map['salinity']['value']
        self.assertIsNotNone(sal)
        self.assertGreater(sal, 20.0)
        self.assertLess(sal, 40.0)

        # Currents
        cur = val_map['currents']
        self.assertTrue(cur['available'])
        self.assertIn('uo', cur['value'])
        self.assertIn('vo', cur['value'])

    def test_ocean_region_array(self):
        arr = ocean_region_array(
            file='currents.nc',
            variable='uo',
            lat_min=18.0,
            lat_max=20.0,
            lon_min=88.0,
            lon_max=90.0,
            depth_min=0,
            depth_max=10,
            stride=2
        )
        self.assertIn('shape', arr)
        self.assertIn('data', arr)
        self.assertIn('dimensions', arr)

    def test_observations_and_profile_comparison(self):
        obs_res = list_observations()
        self.assertGreater(obs_res['count'], 0)
        obs_list = obs_res['observations']
        first_obs = obs_list[0]
        self.assertIn('wmo', first_obs)
        self.assertIn('cycles', first_obs)

        # Test vertical profile comparison
        cmp = compare_observation(
            obs_id=first_obs['id']
        )
        self.assertIn('comparison', cmp)
        self.assertIn('rmse', cmp)
        self.assertIn('bias', cmp)
        self.assertIsInstance(cmp['comparison'], list)
        self.assertGreater(len(cmp['comparison']), 0)
        self.assertIsNotNone(cmp['rmse'])

    def test_legacy_backward_compatibility(self):
        c = legacy_ocean_catalog()
        self.assertIn('variables', c)
        t = legacy_ocean_time()
        self.assertGreater(t['count'], 0)
        p = legacy_ocean_point(latitude=19.5, longitude=88.5)
        self.assertIn('values', p)
        g = legacy_ocean_current_grid(stride=5)
        self.assertIn('u', g)
        o = legacy_ocean_observations()
        self.assertGreater(o['count'], 0)
        datasets = legacy_datasets()
        self.assertGreater(datasets['count'], 0)

    def test_sanitize_edge_cases(self):
        self.assertIsNone(sanitize(float('nan')))
        self.assertIsNone(sanitize(float('inf')))
        self.assertEqual(sanitize(42.5), 42.5)
        self.assertEqual(sanitize(np.float32(10.5)), 10.5)
        arr = np.array([[1.0, float('nan')], [float('inf'), 4.0]])
        cleaned = sanitize(arr)
        self.assertEqual(cleaned, [[1.0, None], [None, 4.0]])

    def test_high_concurrency_thread_safety(self):
        errors = []

        def worker():
            try:
                c = ocean_catalog()
                assert len(c['variables']) > 0
                t = ocean_time()
                assert t['count'] > 0
                p = ocean_point(latitude=19.5, longitude=88.5)
                assert len(p['values']) > 0
                g = ocean_current_grid(stride=5)
                assert len(g['u']) > 0
                b = get_bathymetry(min_lon=84.1, max_lon=93.0, min_lat=16.07, max_lat=23.52)
                assert 'terrain' in b
                geo = get_geography(min_lon=84.1, max_lon=93.0, min_lat=16.07, max_lat=23.52)
                assert len(geo['land']) > 0
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(15)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Encountered concurrency errors: {errors}")


if __name__ == '__main__':
    unittest.main()
