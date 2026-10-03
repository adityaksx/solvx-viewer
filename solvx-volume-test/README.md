# SolvX × Three.js Volume Renderer — Standalone Test Prototype

A standalone testing application to prove that real SolvX NetCDF scientific data can be converted into a 3D scalar volume and rendered as a physically positioned, depth-dependent ocean field with land and bathymetric seabed visible using ray-marching volume rendering.

## Components

1. **Backend (`backend/`)**:
   - FastAPI server with automatic dimension discovery (`lat`, `lon`, `depth`, `time`).
   - Scalar volume normalization preserving physical min/max.
   - NaN / `_FillValue` alpha masking for transparent land/exterior.
   - High-performance binary streaming of Float32 3D volumes.
   - Ground-truth CPU point probe API (`/api/point`).

2. **Frontend (`frontend/`)**:
   - Donitzo ray-marching volume renderer adapted for Three.js.
   - Volumetric depth testing against scene depth buffer (seabed/land occlusion).
   - Dynamic procedural palettes (Turbo/Thermal, Viridis, CoolWarm, Haline).
   - Interactive 3D OrbitControls, top/side/3D views, depth sliders, slice mode.
   - Real-time HUD and cursor click probe.

3. **Data (`data/`)**:
   - Synthetic ocean dataset with vertical thermocline gradient and +5°C warm anomaly.
   - Real Copernicus Marine datasets (`temperature.nc`, `salinity.nc`).
   - GEBCO bathymetric terrain and land geometry.

## Quickstart

```bash
# 1. Run tests
pytest solvx-volume-test/tests/ -v

# 2. Start the application
python -m uvicorn solvx-volume-test.backend.main:app --port 8055
```
Open `http://localhost:8055` in your browser.
