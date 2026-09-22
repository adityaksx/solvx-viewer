import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_ocean_depths():
    response = client.get("/api/ocean/depths?variable=temperature")
    assert response.status_code == 200
    data = response.json()
    assert "depths" in data
    assert len(data["depths"]) >= 1
    assert data["min_depth"] <= data["max_depth"]
    assert "count" in data
    assert data["count"] == len(data["depths"])
    assert data["units"] == "meters"

def test_ocean_slice():
    response = client.get("/api/ocean/slice?variable=temperature&depth=100")
    assert response.status_code == 200
    data = response.json()
    assert data["variable"] == "temperature"
    assert "values" in data
    assert "latitude" in data
    assert "longitude" in data
    assert len(data["values"]) > 0
    assert len(data["values"][0]) > 0
    assert "min_val" in data
    assert "max_val" in data
    assert data["min_val"] <= data["max_val"]

def test_ocean_vertical_slice_constant_lat():
    response = client.get("/api/ocean/vertical-slice?variable=temperature&latitude=18.5&num_points=40")
    assert response.status_code == 200
    data = response.json()
    assert data["variable"] == "temperature"
    assert data["transect_type"] == "constant_latitude"
    assert "stations" in data
    assert len(data["stations"]) == 40
    assert "depths" in data
    assert len(data["depths"]) >= 1
    assert "values" in data
    assert len(data["values"]) == len(data["depths"])
    assert len(data["values"][0]) == 40
    assert data["total_distance_km"] > 0

def test_ocean_vertical_slice_diagonal():
    response = client.get("/api/ocean/vertical-slice?variable=temperature&start_lat=17.0&start_lon=85.0&end_lat=21.0&end_lon=90.0&num_points=30")
    assert response.status_code == 200
    data = response.json()
    assert data["transect_type"] == "custom"
    assert len(data["stations"]) == 30
    assert len(data["values"][0]) == 30
    assert data["total_distance_km"] > 0
