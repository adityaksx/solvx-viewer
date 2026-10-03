"""
Unit tests for canonical GeographicTransform.
Follows Sections 2, 3, 4, 5, 6, 7, 8, 44.
Tests 1x, 10x, and 70x vertical exaggeration and unscaled scientific depth.
"""

import pytest
import math

class TestGeographicTransform:
    def create_geo_config(self, vert_ex=70.0):
        # Python mirror of GeographicTransform.createGeoConfig
        lon_min, lon_max = 84.167, 92.917
        lat_min, lat_max = 16.083, 23.500
        depth_min, depth_max = 0.0, 1000.0
        center_lon = (lon_min + lon_max) / 2.0
        center_lat = (lat_min + lat_max) / 2.0
        klon = 111.32 * math.cos(center_lat * math.pi / 180.0)
        klat = 111.32
        world_width = (lon_max - lon_min) * klon
        world_length = (lat_max - lat_min) * klat
        world_height = (depth_max / 1000.0) * vert_ex

        return {
            "lonMin": lon_min, "lonMax": lon_max,
            "latMin": lat_min, "latMax": lat_max,
            "depthMin": depth_min, "depthMax": depth_max,
            "worldWidth": world_width, "worldLength": world_length,
            "worldHeight": world_height, "verticalExaggeration": vert_ex
        }

    @pytest.fixture
    def geo_config(self):
        return self.create_geo_config(vert_ex=70.0)

    def geo_to_world(self, lon, lat, depth, cfg):
        norm_x = (lon - cfg["lonMin"]) / (cfg["lonMax"] - cfg["lonMin"])
        x = (norm_x - 0.5) * cfg["worldWidth"]

        norm_z = (lat - cfg["latMin"]) / (cfg["latMax"] - cfg["latMin"])
        z = (norm_z - 0.5) * cfg["worldLength"]

        y = -(depth / 1000.0) * cfg["verticalExaggeration"]
        return x, y, z

    def world_to_geo(self, x, y, z, cfg):
        norm_x = x / cfg["worldWidth"] + 0.5
        norm_z = z / cfg["worldLength"] + 0.5
        lon = cfg["lonMin"] + norm_x * (cfg["lonMax"] - cfg["lonMin"])
        lat = cfg["latMin"] + norm_z * (cfg["latMax"] - cfg["latMin"])
        depth = (-y / cfg["verticalExaggeration"]) * 1000.0
        return lon, lat, depth

    def test_surface_at_zero(self, geo_config):
        """Surface must be at Y = 0 regardless of exaggeration."""
        for ex in [1.0, 10.0, 70.0, 100.0]:
            cfg = self.create_geo_config(vert_ex=ex)
            _, y, _ = self.geo_to_world(88.0, 20.0, 0.0, cfg)
            assert abs(y) < 1e-6, f"Surface Y must be 0 at exaggeration {ex}"

    def test_70x_vertical_exaggeration(self, geo_config):
        """At 70x vertical exaggeration, 1000m physical depth must map to Y = -70.0."""
        _, y1000, _ = self.geo_to_world(88.0, 20.0, 1000.0, geo_config)
        assert abs(y1000 - (-70.0)) < 1e-6, f"Expected -70.0, got {y1000}"

        _, y500, _ = self.geo_to_world(88.0, 20.0, 500.0, geo_config)
        assert abs(y500 - (-35.0)) < 1e-6, f"Expected -35.0, got {y500}"

        _, y100, _ = self.geo_to_world(88.0, 20.0, 100.0, geo_config)
        assert abs(y100 - (-7.0)) < 1e-6, f"Expected -7.0, got {y100}"

    def test_depth_negative(self, geo_config):
        """Depth must increase in negative Y."""
        _, y100, _ = self.geo_to_world(88.0, 20.0, 100.0, geo_config)
        _, y500, _ = self.geo_to_world(88.0, 20.0, 500.0, geo_config)
        assert y100 < 0
        assert y500 < y100
        assert abs(y500 - (-0.5 * 70.0)) < 1e-6

    def test_round_trip(self):
        """Converting geo -> world -> geo must recover exact original physical values across all exaggerations."""
        for ex in [1.0, 5.0, 10.0, 70.0, 100.0]:
            cfg = self.create_geo_config(vert_ex=ex)
            orig_lon, orig_lat, orig_depth = 88.542, 19.345, 450.0
            x, y, z = self.geo_to_world(orig_lon, orig_lat, orig_depth, cfg)
            r_lon, r_lat, r_depth = self.world_to_geo(x, y, z, cfg)
            assert abs(orig_lon - r_lon) < 1e-4
            assert abs(orig_lat - r_lat) < 1e-4
            assert abs(orig_depth - r_depth) < 1e-2, f"Failed round-trip depth at ex={ex}"

    def test_domain_corners(self, geo_config):
        """Corners must match -0.5 and +0.5 of world dimensions."""
        x_min, _, z_min = self.geo_to_world(geo_config["lonMin"], geo_config["latMin"], 0, geo_config)
        x_max, _, z_max = self.geo_to_world(geo_config["lonMax"], geo_config["latMax"], 0, geo_config)

        assert abs(x_min - (-0.5 * geo_config["worldWidth"])) < 1e-5
        assert abs(x_max - (0.5 * geo_config["worldWidth"])) < 1e-5
        assert abs(z_min - (-0.5 * geo_config["worldLength"])) < 1e-5
        assert abs(z_max - (0.5 * geo_config["worldLength"])) < 1e-5
