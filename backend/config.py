from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

DATA_DIR = BASE_DIR / 'data'
MODEL_DATA_DIR = DATA_DIR / 'model'
EXTERNAL_DATA_DIR = DATA_DIR / 'external'
EXTERNAL_OCEAN_DIR = EXTERNAL_DATA_DIR / 'ocean'
EXTERNAL_OCEAN_MANIFEST = EXTERNAL_OCEAN_DIR / 'manifest.json'

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
        'description': 'High-resolution GEBCO + INCOIS ocean model data',
        'badge': 'Basin'
    },
    {
        'id': 'arabian_sea',
        'name': 'Arabian Sea',
        'bbox': {'min_lon': 60.00, 'max_lon': 76.00, 'min_lat': 10.00, 'max_lat': 24.00},
        'description': 'Western Indian Ocean & Somali Current',
        'badge': 'Sea'
    },
    {
        'id': 'indian_ocean',
        'name': 'Indian Ocean',
        'bbox': {'min_lon': 55.00, 'max_lon': 95.00, 'min_lat': -15.00, 'max_lat': 15.00},
        'description': 'Tropical Indian Ocean & monsoon drift basin',
        'badge': 'Ocean'
    },
    {
        'id': 'north_atlantic',
        'name': 'North Atlantic',
        'bbox': {'min_lon': -65.00, 'max_lon': -20.00, 'min_lat': 15.00, 'max_lat': 45.00},
        'description': 'Subtropical gyre, Sargasso Sea & Gulf Stream',
        'badge': 'Ocean'
    },
    {
        'id': 'south_atlantic',
        'name': 'South Atlantic',
        'bbox': {'min_lon': -35.00, 'max_lon': 10.00, 'min_lat': -35.00, 'max_lat': -10.00},
        'description': 'South Atlantic basin & Benguela Current',
        'badge': 'Ocean'
    },
    {
        'id': 'north_pacific',
        'name': 'North Pacific',
        'bbox': {'min_lon': 130.00, 'max_lon': 170.00, 'min_lat': 15.00, 'max_lat': 45.00},
        'description': 'Northwest Pacific basin & Kuroshio extension',
        'badge': 'Ocean'
    },
    {
        'id': 'south_pacific',
        'name': 'South Pacific',
        'bbox': {'min_lon': -150.00, 'max_lon': -110.00, 'min_lat': -35.00, 'max_lat': -5.00},
        'description': 'South Pacific central subtropical gyre',
        'badge': 'Ocean'
    },
    {
        'id': 'mediterranean_sea',
        'name': 'Mediterranean Sea',
        'bbox': {'min_lon': 0.00, 'max_lon': 36.00, 'min_lat': 30.00, 'max_lat': 44.00},
        'description': 'Semi-enclosed intercontinental marginal sea',
        'badge': 'Sea'
    },
    {
        'id': 'southern_ocean',
        'name': 'Southern Ocean',
        'bbox': {'min_lon': -70.00, 'max_lon': -20.00, 'min_lat': -65.00, 'max_lat': -50.00},
        'description': 'Antarctic Circumpolar Current & Drake Passage',
        'badge': 'Ocean'
    },
    {
        'id': 'arctic_ocean',
        'name': 'Arctic Ocean',
        'bbox': {'min_lon': -10.00, 'max_lon': 50.00, 'min_lat': 68.00, 'max_lat': 82.00},
        'description': 'Greenland and Barents Sea polar waters',
        'badge': 'Ocean'
    },
    {
        'id': 'gulf_of_mexico',
        'name': 'Gulf of Mexico',
        'bbox': {'min_lon': -97.00, 'max_lon': -80.00, 'min_lat': 18.00, 'max_lat': 31.00},
        'description': 'Loop Current & Gulf Coast ocean system',
        'badge': 'Sea'
    },
    {
        'id': 'red_sea',
        'name': 'Red Sea',
        'bbox': {'min_lon': 32.00, 'max_lon': 44.00, 'min_lat': 12.00, 'max_lat': 28.50},
        'description': 'Narrow inlet basin and rift zone',
        'badge': 'Sea'
    },
    {
        'id': 'strait_of_hormuz',
        'name': 'Strait of Hormuz',
        'bbox': {'min_lon': 55.50, 'max_lon': 57.50, 'min_lat': 25.50, 'max_lat': 27.20},
        'description': 'Strategic Persian Gulf strait',
        'badge': 'Strait'
    },
    {
        'id': 'strait_of_malacca',
        'name': 'Strait of Malacca',
        'bbox': {'min_lon': 98.00, 'max_lon': 104.50, 'min_lat': 1.00, 'max_lat': 6.00},
        'description': 'Indo-Pacific maritime gateway',
        'badge': 'Strait'
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
MAX_REQUEST_AREA_DEG2 = float(os.getenv('MAX_REQUEST_AREA_DEG2', '1500.0'))

# Data Collector & Adapter Environment Configuration
LOCAL_DATA_MODE = os.getenv('SOLVX_LOCAL_DATA_MODE', os.getenv('LOCAL_DATA_MODE', 'false')).lower() in ('1', 'true', 'yes')
MOCK_DATA = os.getenv('MOCK_DATA', 'false').lower() in ('1', 'true', 'yes')

# INCOIS ERDDAP & Ocean Data Services
INCOIS_BASE_URL = os.getenv('INCOIS_BASE_URL', 'https://erddap.incois.gov.in/erddap').rstrip('/')
INCOIS_API_KEY = os.getenv('INCOIS_API_KEY', '')
INCOIS_USERNAME = os.getenv('INCOIS_USERNAME', '')
INCOIS_PASSWORD = os.getenv('INCOIS_PASSWORD', '')

# Bathymetry and Geography Sources
BATHYMETRY_BASE_URL = os.getenv('BATHYMETRY_BASE_URL', 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_global_mosaic/ImageServer/exportImage')
GEOGRAPHY_BASE_URL = os.getenv('GEOGRAPHY_BASE_URL', 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson')
EEZ_DATA_PATH = DATA_DIR / 'World_EEZ_v12_20231025_LR.zip'


# Network and Cache Settings
REQUEST_TIMEOUT = int(os.getenv('REQUEST_TIMEOUT', '12'))
CACHE_MAX_SIZE = int(os.getenv('CACHE_MAX_SIZE', '256'))
CACHE_TTL = int(os.getenv('CACHE_TTL', '3600'))

# Legacy external scientific API endpoints
NOAA_ERDDAP_BASE = os.getenv('NOAA_ERDDAP_URL', 'https://coastwatch.pfeg.noaa.gov/erddap/griddap')
COPERNICUS_API_KEY = os.getenv('COPERNICUS_API_KEY', '')
MAPTILER_API_KEY = os.getenv('MAPTILER_API_KEY', '')

# Gemini AI Assistant Configuration
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')


