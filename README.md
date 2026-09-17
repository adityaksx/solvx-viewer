# SolvX — Interactive 3D Ocean Explorer (v3.0)

SolvX is a scientific 3D oceanographic visualization and data exploration platform. It couples a global 3D Earth selector with a regional Three.js/WebGL ocean basin scene powered by a high-performance, thread-safe FastAPI backend that dynamically extracts and subsets NetCDF ocean models, bathymetry grids, coastline geometry, and in-situ Argo float profiles.

---

## Architecture Flow

```
+-------------------------------------------------------------------------------+
|                             INTERACTIVE WORLD GLOBE                           |
|  - Three.js 3D Sphere with procedural Earth textures and graticules          |
|  - Bounding Box Drag / Coordinate Form / Major Basin Presets (e.g. Bay of Bengal) |
+---------------------------------------+---------------------------------------+
                                        | (Select Region: [min_lon, max_lon, min_lat, max_lat])
                                        v
+-------------------------------------------------------------------------------+
|                               FASTAPI BACKEND                                 |
|  - /api/region       : Preset basins & bbox validation                        |
|  - /api/geography    : Natural Earth 10m land & coastline vectors             |
|  - /api/bathymetry   : GEBCO / model bathymetric seabed elevation grids       |
|  - /api/ocean        : 3D/4D NetCDF subsets (temp, salinity, currents, SLA)   |
|  - /api/observations : In-situ Argo float vertical profiles & model RMSE/bias |
|  - Thread-safe NetCDF access with re-entrant locks & LRU caching             |
+---------------------------------------+---------------------------------------+
                                        | (JSON payloads & downsampled arrays)
                                        v
+-------------------------------------------------------------------------------+
|                              3D REGIONAL SCENE                                |
|  - 3D Extruded Land & Bedrock Slab                                            |
|  - Shoreline & Exclusive Economic Zone (EEZ) Boundaries                       |
|  - 3D Bathymetric Seabed Mesh & Procedural Seabed Vegetation                  |
|  - Dynamic Animated Ocean Water Surface with Wave Shader Animation            |
|  - 3D Scientific Layers (Temperature, Salinity, Velocity Vector Arrows)       |
|  - Animated Particle Advection Streamlines                                    |
|  - Interactive In-Situ Argo Float soundings with live model comparison modal  |
+-------------------------------------------------------------------------------+
```

---

## Key Features

1. **Interactive World Globe & Region Selector**:
   - Interactive 3D Earth globe with orbit navigation, graticule lines, atmospheric glow, and preset ocean basins (Bay of Bengal, Arabian Sea, South China Sea, Gulf of Mexico, Mediterranean Sea).
   - Dynamic coordinate bounding box entry with instant validation.
2. **Dynamic 3D Geography & Bathymetry**:
   - Dynamic extraction of land polygons and coastlines from Natural Earth 10m zip datasets on the fly.
   - Smooth bathymetric seabed mesh with realistic vertical elevation scaling.
   - Procedural seabed decoration (seagrass tufts and rock clusters, clearly flagged visual-only).
3. **Dynamic Ocean Physics & Wave Simulation**:
   - Animated water surface with sinusoidal wave vertex displacement and volumetric water column.
4. **Scientific Visualization Layers**:
   - **Temperature**: 3D thermal gradient field with depth slicing and volume opacity.
   - **Salinity**: Practical Salinity Units (PSU) field.
   - **Currents**: 3D velocity vectors (`uo`, `vo`) and animated particle flow advection.
   - **Sea Level Anomaly**: Sea surface height variations.
5. **In-Situ Observation Comparison**:
   - Real Argo float sounding beacons rendered in 3D with vertical profiling wires down to 1000m.
   - Clickable float inspection modal with side-by-side vertical profile curves, RMSE, and bias error metrics against model predictions.
6. **Robust Thread Safety & Performance**:
   - Thread-safe NetCDF access using re-entrant `threading.RLock()` to prevent C-level `libnetcdf.so` segfaults.
   - High-throughput LRU in-memory caching and payload downsampling with stride support.

---

## Directory Structure

```
solvx-viewer/
├── backend/
│   ├── main.py                     # FastAPI entry point & backward compatibility routes
│   ├── config.py                   # Basin presets, paths, thresholds, and defaults
│   ├── models/
│   │   └── requests.py             # Pydantic request models & coordinate validators
│   ├── processing/
│   │   ├── coordinate_utils.py     # Lon/Lat to regional km Easting/Northing projection
│   │   ├── normalization.py        # Nan/Inf sanitization & variable cataloging
│   │   ├── subset.py               # Multidimensional xarray downsampling & slicing
│   │   └── interpolation.py        # 1D vertical profile interpolation & RMSE/bias computation
│   ├── services/
│   │   ├── cache_service.py        # Thread-safe NetCDF lock & LRU memory cache
│   │   ├── geography_service.py    # Natural Earth 10m land & coastline extraction
│   │   ├── bathymetry_service.py   # Seabed elevation grid generation
│   │   ├── ocean_data_service.py   # NetCDF model reading (temperature, currents, etc.)
│   │   └── observation_service.py  # Argo float sounding profiles & collocation
│   └── api/
│       ├── region.py               # /api/region endpoints
│       ├── geography.py            # /api/geography endpoints
│       ├── bathymetry.py           # /api/bathymetry endpoints
│       ├── ocean.py                # /api/ocean endpoints
│       └── observations.py         # /api/observations endpoints
├── frontend/
│   ├── index.html                  # Responsive HTML shell
│   ├── styles.css                  # Marine design system stylesheet
│   ├── app.js                      # Application orchestrator (Globe <-> 3D Scene <-> Controls)
│   ├── api/
│   │   └── apiClient.js            # Unified async API client
│   ├── globe/
│   │   ├── worldMap.js             # Interactive 3D Earth globe with selection box
│   │   ├── regionSelector.js       # Ocean basin preset chips
│   │   └── coordinateInput.js      # Coordinate input form
│   ├── scene/
│   │   ├── oceanScene.js           # Three.js scene manager, camera presets & lighting
│   │   ├── land.js                 # 3D extruded land geometry & bedrock slab
│   │   ├── coastline.js            # Coastline vectors & EEZ boundary beads
│   │   ├── seabed.js               # 3D bathymetric seabed mesh
│   │   ├── vegetation.js           # Procedural seabed decoration (seagrass/rocks)
│   │   └── water.js                # Dynamic water surface & volumetric column
│   ├── visualization/
│   │   ├── colorScale.js           # Scientific colormaps & legend generator
│   │   ├── temperature.js          # Temperature layer & vertical slicing
│   │   ├── salinity.js             # Salinity layer
│   │   ├── currents.js             # 3D current velocity arrows
│   │   └── particles.js            # Animated flow particle system
│   └── controls/
│       ├── variableControl.js      # Physical variable selector
│       ├── depthControl.js         # Depth slider & volume/slice toggle
│       ├── timelineControl.js      # Temporal scrubber & play/pause loop
│       └── opacityControl.js       # Vertical exaggeration & layer opacity
├── data/                           # Natural Earth shapes & NetCDF ocean models
├── tests/
│   └── test_all.py                 # Automated unit and concurrency test suite
├── run.py                          # Unified launcher (Backend: 8000, Frontend: 5500)
└── requirements.txt                # Python dependencies
```

---

## Quick Start

### 1. Requirements & Setup

```bash
# Clone the repository
git clone https://github.com/adityaksx/solvx-viewer.git
cd solvx-viewer

# Activate virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Launch SolvX

```bash
python run.py
```

The launcher will:
1. Start the FastAPI backend at `http://127.0.0.1:8000` (interactive docs at `http://127.0.0.1:8000/docs`).
2. Start the HTTP frontend server at `http://127.0.0.1:5500`.
3. Automatically open `http://127.0.0.1:5500` in your default web browser.

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | API health check and version info |
| `GET` | `/api/region/presets` | List predefined major ocean basins (Bay of Bengal, etc.) |
| `POST` | `/api/region/validate` | Validate geographic bounds and calculate dimensions |
| `GET` | `/api/geography` | Retrieve 3D land polygons, coastline vectors, and EEZ lines |
| `GET` | `/api/bathymetry` | Retrieve seabed elevation grid (`x, y, rawDepthKm`) |
| `GET` | `/api/ocean/catalog` | List available ocean variables with units and ranges |
| `GET` | `/api/ocean/time` | List temporal coordinate steps in the model dataset |
| `GET` | `/api/ocean/current-grid` | Retrieve horizontal current vectors (`u, v`) across grid |
| `GET` | `/api/ocean/point` | Inspect all physical variables at a specific (lat, lon) point |
| `GET` | `/api/ocean/region-array` | Downsampled 3D array subset for a specific variable |
| `GET` | `/api/observations` | Retrieve in-situ Argo float profiles in the selected region |
| `GET` | `/api/observations/compare/{id}` | Vertical profile comparison between float and model (with RMSE & bias) |

---

## Running Automated Tests

Run the comprehensive unit and concurrency test suite:

```bash
python -m unittest tests/test_all.py
```

The test suite validates:
- API root and health checks
- Region presets and Pydantic validation (including boundary constraints)
- Dynamic geography and bathymetry services
- Ocean catalog, temporal steps, current grids, point queries, and region array subsets
- In-situ Argo observation retrieval and vertical profile comparison with RMSE/bias
- Legacy endpoint backward compatibility
- Multi-threaded concurrency safety (15 parallel threads executing simultaneous NetCDF queries)

