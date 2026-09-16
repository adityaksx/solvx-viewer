import unittest
import threading
import numpy as np
from backend.main import (
    root,
    ocean_catalog,
    ocean_time,
    ocean_point,
    ocean_current_grid,
    ocean_observations,
    sanitize,
    NETCDF_LOCK,
    OPEN_DATASETS
)

class TestSolvXBackend(unittest.TestCase):
    def test_root(self):
        data = root()
        self.assertEqual(data['name'], 'SolvX Ocean Data API')
        self.assertEqual(data['status'], 'running')

    def test_ocean_catalog(self):
        data = ocean_catalog()
        self.assertIn('variables', data)
        var_ids = {v['id'] for v in data['variables']}
        self.assertIn('temperature', var_ids)
        self.assertIn('salinity', var_ids)
        self.assertIn('currents', var_ids)
        self.assertIn('sea_level', var_ids)

    def test_ocean_time(self):
        data = ocean_time()
        self.assertGreater(data['count'], 0)
        self.assertEqual(len(data['values']), data['count'])

    def test_ocean_point_bay_of_bengal(self):
        data = ocean_point(latitude=19.5, longitude=88.5)
        self.assertEqual(data['latitude'], 19.5)
        self.assertEqual(data['longitude'], 88.5)
        val_map = {v['id']: v for v in data['values']}
        
        # Temperature in Bay of Bengal is typically between 20C and 35C
        temp = val_map['temperature']['value']
        self.assertIsNotNone(temp)
        self.assertGreater(temp, 20.0)
        self.assertLess(temp, 35.0)

        # Salinity in Bay of Bengal is typically 25 to 40 PSU
        sal = val_map['salinity']['value']
        self.assertIsNotNone(sal)
        self.assertGreater(sal, 20.0)
        self.assertLess(sal, 40.0)

        # Currents
        cur = val_map['currents']
        self.assertTrue(cur['available'])
        self.assertIn('uo', cur['value'])
        self.assertIn('vo', cur['value'])
        self.assertIsNotNone(cur.get('speed'))

        # Chlorophyll should be gracefully marked unavailable with None
        chl = val_map['chlorophyll']
        self.assertFalse(chl['available'])
        self.assertIsNone(chl['value'])

    def test_ocean_current_grid(self):
        data = ocean_current_grid(stride=4)
        self.assertIn('u', data)
        self.assertIn('v', data)
        self.assertIn('latitude', data)
        self.assertIn('longitude', data)
        self.assertEqual(len(data['u']), len(data['latitude']))
        self.assertEqual(len(data['u'][0]), len(data['longitude']))

    def test_ocean_observations(self):
        data = ocean_observations()
        self.assertGreater(data['count'], 0)
        obs = data['observations'][0]
        self.assertIn('wmo', obs)
        self.assertIn('profile', obs)
        self.assertGreater(len(obs['profile']), 0)

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
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(15)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Encountered concurrency errors: {errors}")

    def test_sanitize_edge_cases(self):
        self.assertIsNone(sanitize(float('nan')))
        self.assertIsNone(sanitize(float('inf')))
        self.assertEqual(sanitize(42.5), 42.5)
        self.assertEqual(sanitize(np.float32(10.5)), 10.5)
        arr = np.array([[1.0, float('nan')], [float('inf'), 4.0]])
        cleaned = sanitize(arr)
        self.assertEqual(cleaned, [[1.0, None], [None, 4.0]])

if __name__ == '__main__':
    unittest.main()
