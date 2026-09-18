from .incois_adapter import INCOISAdapter, INCOIS_VARIABLE_MAP
from .noaa_adapter import NOAAAdapter, NOAA_VARIABLE_MAP
from .copernicus_adapter import CopernicusAdapter
from .hycom_adapter import HYCOMAdapter, HYCOM_VARIABLE_MAP
from .bathymetry_adapter import GEBCOAdapter, BathymetryAdapter
from .geography_adapter import GeographyAdapter
from .observation_adapter import ObservationAdapter
from .eez_adapter import EEZAdapter

__all__ = [
    'INCOISAdapter',
    'INCOIS_VARIABLE_MAP',
    'NOAAAdapter',
    'NOAA_VARIABLE_MAP',
    'CopernicusAdapter',
    'COPERNICUS_VARIABLE_MAP',
    'HYCOMAdapter',
    'HYCOM_VARIABLE_MAP',
    'GEBCOAdapter',
    'BathymetryAdapter',
    'GeographyAdapter',
    'ObservationAdapter',
    'EEZAdapter'
]
