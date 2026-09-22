import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_list_argo_observations():
    response = client.get("/api/observations/argo")
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "ARGO"
    assert "count" in data
    assert data["count"] > 0
    assert len(data["observations"]) == data["count"]

    first_obs = data["observations"][0]
    assert "float_id" in first_obs
    assert "wmo" in first_obs
    assert "latitude" in first_obs
    assert "longitude" in first_obs
    assert "profile" in first_obs
    assert len(first_obs["profile"]) > 0
    assert "available_variables" in first_obs
    assert "temperature" in first_obs["available_variables"]

def test_list_argo_observations_bbox_filter():
    # Filter for northern Bay of Bengal (latitude >= 19.0)
    response = client.get("/api/observations/argo?min_lat=19.0&max_lat=22.0&min_lon=85.0&max_lon=92.0")
    assert response.status_code == 200
    data = response.json()
    for obs in data["observations"]:
        assert 19.0 <= obs["latitude"] <= 22.0
        assert 85.0 <= obs["longitude"] <= 92.0

def test_get_argo_profile_by_id():
    response = client.get("/api/observations/argo/2902694")
    assert response.status_code == 200
    data = response.json()
    assert data["source"] == "ARGO"
    assert data["wmo"] == 2902694
    assert len(data["profile"]) > 0
    assert data["profile"][0]["depth"] > 0
    assert data["profile"][0]["temp"] is not None
    assert "metadata" in data
    assert data["metadata"]["dac"] == "INCOIS"

def test_get_argo_profile_not_found():
    response = client.get("/api/observations/argo/9999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()

def test_legacy_observations_endpoint():
    response = client.get("/api/observations")
    assert response.status_code == 200
    data = response.json()
    assert "observations" in data
    assert data["count"] > 0
