# SolvX Current Architecture Audit (`docs/ARCHITECTURE_CURRENT.md`)

*Generated as part of Stage 1 (Safety) in accordance with `plan.md` Section 4.*

---

## 1. Executive Summary

SolvX is a scientific 3D oceanographic visualization and data exploration platform. It couples a global 2D/3D map selector with a regional Three.js/WebGL ocean basin scene powered by a FastAPI Python backend that serves NetCDF ocean models, bathymetry grids, coastline geometry, and observation datasets.

This document records the exact state of the codebase prior to the addition of Stage 2 (Depth Slice, Vertical Slice) and subsequent analysis layers.

---

## 2. Comprehensive Repository Audit

### 2.1 Frontend Framework
- **Architecture**: Native browser ES Modules (`<script type="module" src="app.js">`), no bundler required (Vite/Webpack not enforced).
- **Import Map**: Configured in `frontend/index.html` resolving `three` and `three/addons/` via unpkg CDN (`three@0.180.0`).
- **Styling**: Vanilla CSS3 (`styles.css`, `download.css`) using CSS custom properties (`--bg-primary`, `--accent-cyan`, `--glass-surface`, etc.), Glassmorphism, and responsive layout grids.
- **Entry Point**: `frontend/index.html` launching `frontend/app.js`.

### 2.2 Backend Framework
- **Server**: FastAPI (`v0.115+`), running on ASGI Uvicorn (`uvicorn.run("backend.main:app", host="127.0.0.1", port=8080)`).
- **Concurrency & Thread Safety**: Multi-threaded FastAPI with global NetCDF file synchronization lock (`NETCDF_LOCK = threading.Lock()`) and dataset metadata indexing in `backend/services/cache_service.py` to prevent HDF5/NetCDF file descriptor corruption under concurrent access.
- **Compression**: `GZipMiddleware` enabled for payloads $> 1000$ bytes.
- **Static Hosting**: Python `ThreadingHTTPServer` on port `5500` serving the `frontend/` directory (launched via `run.py`).

### 2.3 3D Graphics Library
- **Library**: Three.js (`v0.180.0`), WebGLRenderer with `antialias: true`, `powerPreference: 'high-performance'`, `stencil: true`, logarithmic depth buffer enabled where appropriate.
- **Camera & Scene**: `THREE.PerspectiveCamera` (FOV $45^\circ$, near $0.1$, far $10000$), `OrbitControls` with damping, pan, zoom, and preset orientations (`3d`, `top`, `profile`, `under`).
- **Scene Assembly**: `frontend/scene/oceanScene.js` manages scene lights (ambient, directional sun, fill light), root groups, coordinate transformations, and the animation loop.

### 2.4 Existing Ocean Rendering Implementation
- **Basin & Coordinate System**: `frontend/scene/oceanScene.js` defines meter-to-scene coordinate mapping:
  - Longitude $\rightarrow X$ (normalized across bounding box).
  - Latitude $\rightarrow Z$ (normalized across bounding box).
  - Depth $\rightarrow Y$ (negative downward, scaled by vertical exaggeration factor $10\times - 70\times$, default $70\times$).
- **Scalar Field Rendering**: `frontend/visualization/scalar.js`:
  - Visualizes scalar variables (temperature, salinity, etc.) using custom GPU textures (`frontend/visualization/dataTexture.js`).
  - Supports volume recoloring via instanced cell meshes (`water.recolorCells(...)`) and planar slice textures (`sliceMesh` with custom ShaderMaterial).
- **Currents & Vectors**: `frontend/visualization/currents.js` (vector arrow field) and `frontend/visualization/particles.js` (GPU animated flow particle advection).

### 2.5 Existing Water Implementation
- **Location**: `frontend/scene/water.js` & `frontend/scene/oceanShader.js`.
- **Subsurface Column**: Instanced 3D water volume mesh (`THREE.InstancedMesh` with `THREE.BoxGeometry`) generated from GEBCO bathymetry depth grid. Color gradient transitions with depth from light cyan near surface ($0\text{ m}$) to deep cobalt ($>2000\text{ m}$).
- **Surface Animated Mesh**: Plane geometry ($128 \times 128$ subdivisions) positioned at $Y=0$ (sea level) driven by custom GLSL shaders (`OceanVertShader` and `OceanFragShader`).
- **Shader Dynamics**:
  - Vertex shader computes trochoidal wave displacement parameterized by `uWaveHeight` and `uTime`.
  - Fragment shader computes Fresnel reflection between `uBaseColor` and `uSkyColor`, and samples `uBathyTex` to discard pixels over land elevation.
  - Dynamically displays active variable scalar textures (`uDataTex`) on the water surface when inspecting surface variables.
- **Critical Asset Rule**: This water implementation is self-contained and working. It must remain reusable as the core rendering asset.

### 2.6 Existing Copernicus API & Integration
- **Adapter**: `backend/adapters/copernicus_adapter.py` (`CopernicusAdapter`).
- **Client**: Uses official `copernicusmarine` Python SDK (`copernicusmarine.subset(...)`).
- **Authentication**: Discovers credentials from environment variables (`COPERNICUSMARINE_SERVICE_USERNAME`, `COPERNICUSMARINE_SERVICE_PASSWORD`) or disk credentials file (`.copernicusmarine/.copernicusmarine-credentials`).
- **Caching**: Full-timeline batch caching locally in `data/external/ocean/cmems_*.nc`.

### 2.7 Exact Copernicus Product & Dataset Identification
- **Dataset Identification**:
  - Physics (Temperature): `cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m` (var: `thetao`, units: `°C`, 3D).
  - Physics (Salinity): `cmems_mod_glo_phy-so_anfc_0.083deg_P1D-m` (var: `so`, units: `PSU`, 3D).
  - Physics (Currents): `cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m` (vars: `uo`, `vo`, units: `m/s`, 3D vector).
  - Physics (Sea Surface Height): `cmems_mod_glo_phy_anfc_0.083deg_P1D-m` (var: `zos`, units: `m`, 2D surface).
  - Physics (Mixed Layer Depth): `cmems_mod_glo_phy_anfc_0.083deg_P1D-m` (var: `mlotst`, units: `m`, 2D).
  - Physics (SST Anomaly): `cmems_mod_glo_phy_anfc_0.083deg-sst-anomaly_P1D-m` (var: `sst_anomaly`, units: `°C`, 2D).
  - Biogeochemistry (Chlorophyll): `cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m` (var: `chl`, units: `mg/m³`, 3D).
  - Biogeochemistry (Oxygen): `cmems_mod_glo_bgc-bio_anfc_0.25deg_P1D-m` (var: `o2`, units: `mmol/m³`, 3D).
  - Biogeochemistry (Nutrients/Carbon): `cmems_mod_glo_bgc-nut_anfc_0.25deg_P1D-m`, `cmems_mod_glo_bgc-car_anfc_0.25deg_P1D-m`.
- **CRITICAL AUDIT FINDING**: The `mod` designation in the dataset IDs (`cmems_mod_*`) confirms these products are **numerical model analysis and forecast data** produced by Mercator Ocean's NEMO global $1/12^\circ$ ocean model. They are **NOT** in-situ observations. In-situ observations (such as Argo profiles) are distinct and will be ingested separately in Stage 3.

### 2.8 Variables Currently Available
- **Physical**:
  - `ocean_temperature` / `temperature` ($^\circ\text{C}$)
  - `salinity` ($\text{PSU}$)
  - `currents` ($u, v$, speed $\text{m/s}$, direction $^\circ$)
  - `sea_surface_height` / `sea_level` ($\text{m}$)
  - `temperature_anomaly` ($^\circ\text{C}$)
  - `mixed_layer_depth` ($\text{m}$)
- **Biogeochemical**:
  - `chlorophyll` ($\text{mg/m}^3$)
  - `dissolved_oxygen` ($\text{mmol/m}^3$)
  - `ph` ($\text{pH}$)
  - `nitrate` ($\text{mmol/m}^3$)
  - `phosphate` ($\text{mmol/m}^3$)
- **Topographic**:
  - `elevation` / `rawDepthKm` / `depth` ($\text{m}$ / $\text{km}$) via GEBCO 2026.

### 2.9 Dataset Dimensions & Spatial Coverage
- **Local Model Files** (`data/model/*.nc`):
  - Spatial Grid: $90 \text{ latitude points} \times 106 \text{ longitude points}$.
  - Latitude bounds: $16.0833^\circ\text{N} - 23.5000^\circ\text{N}$.
  - Longitude bounds: $84.1667^\circ\text{E} - 92.9167^\circ\text{E}$.
  - Vertical Depth: **32 depth levels** ($0.49\text{ m}, 1.54\text{ m}, 2.65\text{ m}, \dots, 541.09\text{ m}$).
  - Time Dimension: 40 daily steps (`2026-08-01T00:00:00` to `2026-09-09T00:00:00`).
- **Bathymetry Grid** (`data/gebco_*.nc`):
  - 15 arc-second native grid downsampled dynamically to `low` (~$40\times 40$), `medium` (~$80\times 80$), `high` (~$150\times 150$), or `native`.

### 2.10 Existing API Endpoints
- **Central Data (`/api/data/*`)**:
  - `GET /api/data/providers`, `GET /api/data/providers/status`
  - `GET /api/data/ocean`, `POST /api/data/ocean`
  - `GET /api/data/ocean/bundle`
  - `GET /api/data/ocean/check`
  - `GET /api/data/bathymetry`, `POST /api/data/bathymetry`
  - `GET /api/data/region`, `POST /api/data/region`
  - `GET /api/data/variables`
  - `GET /api/data/geometry`, `GET /api/data/coastline`, `GET /api/data/eez`
  - `GET /api/data/timeline`
  - `GET /api/data/observations`, `GET /api/data/observations/compare/{obs_id}`
- **Ocean Specific (`/api/ocean/*`)**:
  - `GET /api/ocean/catalog`
  - `GET /api/ocean/time`
  - `GET /api/ocean/current-grid`
  - `GET /api/ocean/point`
  - `GET /api/ocean/region-array`
  - `POST /api/ocean/query`
- **Region & Bathymetry**:
  - `GET /api/region/terrain`, `GET /api/bathymetry/gebco`

### 2.11 Existing State Management
- **Frontend Architecture**: Singleton application instance (`SolvXApp` in `frontend/app.js`), instantiated and bound to `window.solvx`.
- **Core State Variables**:
  - `activeVar`: Current oceanographic variable (`temperature`, `salinity`, etc.).
  - `activeDepth`: Current depth in meters (default $100\text{ m}$).
  - `activeDepthMode`: Mode of slicing (`volume`, `horizontal`, `vertical`).
  - `activeTime`: ISO 8601 timestamp string.
  - `currentBBox`: Geographic bounding box `{ min_lat, max_lat, min_lon, max_lon }`.
  - `layerState`: Visibility toggles for land, coastline, islands, eez, seabed, water, scientific, currents, particles.
  - `activeProvider`: Selected provider (`auto`, `incois`, `copernicus`, `noaa`, `hycom`).

### 2.12 Existing Components
- `frontend/controls/depthControl.js`: Controls depth mode selection and slice inputs.
- `frontend/controls/variableControl.js`: Variable selection pills categorized by physical & biogeochemical types.
- `frontend/controls/timelineControl.js`: Timeline slider, playback loop, resolution buttons (Hourly, Daily, Monthly).
- `frontend/controls/opacityControl.js`: Vertical exaggeration slider ($10\times - 70\times$).
- `frontend/map/worldMap2D.js`: MapLibre GL 2D interactive world map with bbox drawing (`regionDrawing.js`).
- `frontend/scene/seabed.js`, `land.js`, `coastline.js`, `vegetation.js`: Static geographic and bathymetric layers.
- `frontend/visualization/colorScale.js`: Scientific color palettes (Thermal, Haline, Viridis, Turbo, Speed, Anomaly Diverging).
- `frontend/ui/hazardUI.js`: Ocean hazard monitoring card and anomaly alerts.

### 2.13 Existing Shaders
- `frontend/scene/oceanShader.js`:
  - `OceanVertShader`: Evaluates dual sine-wave trochoidal displacement, passing transformed world-space position and UVs.
  - `OceanFragShader`: Multi-pass fragment shader computing:
    - Bathymetry land mask (`uBathyTex` check, discards pixels where depth $\le 0$).
    - Fresnel water reflection gradient.
    - Surface scalar overlay blending (`uDataTex` and `uDataOpacity`).

### 2.14 Existing Data Transformation Logic
- `backend/processing/normalization.py`: Sanitizes NaN/inf floats to valid JSON values; builds standard variable metadata.
- `backend/processing/subset.py`: Multi-dimensional array subsetting for NetCDF coordinates (`lat`, `lon`, `depth`, `time`).
- `backend/processing/coordinate_utils.py`: Bounding box normalization and validation.
- `backend/processing/interpolation.py`: 1D vertical profile interpolation and statistical comparison (RMSE, bias).

---

## 3. Preservation Directives for Subsequent Stages

1. **Do Not Rebuild 3D Ocean**: `frontend/scene/oceanScene.js` and `frontend/scene/water.js` must remain untouched in their core rendering pipeline.
2. **Controller Abstraction**: All new analysis commands and slicing requests must flow through a thin controller (`viewerController.js`) rather than manipulating 3D meshes directly.
3. **Data Efficiency**: Deliver subsetted slices server-side rather than sending full multi-gigabyte 3D NetCDF cubes over HTTP.
