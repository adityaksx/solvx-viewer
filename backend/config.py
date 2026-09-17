from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / 'data'
MODEL_DATA_DIR = DATA_DIR / 'model'

# Default preset bounding box (Bay of Bengal)
DEFAULT_BBOX = {
    'min_lon': 84.10,
    'max_lon': 93.00,
    'min_lat': 16.07,
    'max_lat': 23.52
}

# Major Ocean Basins Preset Registry
PRESET_REGIONS = [
    {
        'id': 'bay_of_bengal',
        'name': 'Bay of Bengal',
        'bbox': {'min_lon': 84.10, 'max_lon': 93.00, 'min_lat': 16.07, 'max_lat': 23.52},
        'description': 'High-resolution GEBCO + CMEMS model data'
    },
    {
        'id': 'arabian_sea',
        'name': 'Arabian Sea',
        'bbox': {'min_lon': 60.00, 'max_lon': 74.00, 'min_lat': 12.00, 'max_lat': 24.00},
        'description': 'Western Indian Ocean basin'
    },
    {
        'id': 'south_china_sea',
        'name': 'South China Sea',
        'bbox': {'min_lon': 105.00, 'max_lon': 120.00, 'min_lat': 8.00, 'max_lat': 22.00},
        'description': 'Tropical Indo-Pacific marginal sea'
    },
    {
        'id': 'gulf_of_mexico',
        'name': 'Gulf of Mexico',
        'bbox': {'min_lon': -97.00, 'max_lon': -82.00, 'min_lat': 20.00, 'max_lat': 30.00},
        'description': 'Atlantic ocean basin and Loop Current'
    },
    {
        'id': 'mediterranean_sea',
        'name': 'Mediterranean Sea',
        'bbox': {'min_lon': 5.00, 'max_lon': 25.00, 'min_lat': 32.00, 'max_lat': 42.00},
        'description': 'Intercontinental basin'
    }
]

# Geometry and Sampling Parameters
PAD = 0.05
DEPTH_EXAGGERATION = 70.0
LAND_THICKNESS_KM = 3.0
BASE_EXTRA_KM = 1.2
EEZ_BEAD_SPACING_KM = 18.0
MAX_EEZ_BEADS = 650
MAX_GRID_POINTS = 90000
MAX_LAND_TRIANGLES = 30000

# Cache Settings
CACHE_MAX_SIZE = 128

# External scientific API endpoints
NOAA_ERDDAP_BASE = os.getenv('NOAA_ERDDAP_URL', 'https://coastwatch.pfeg.noaa.gov/erddap/griddap')
COPERNICUS_API_KEY = os.getenv('COPERNICUS_API_KEY', '')
