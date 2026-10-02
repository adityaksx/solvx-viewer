# DATA DIAGNOSTIC REPORT: SolvX Ocean Data Structure & Dimensionality

**Date:** 2026-10-02  
**Target Repository:** `adityaksx/solvx-viewer`  
**Purpose:** Pure diagnostic assessment of ocean data pipeline from NetCDF source to Three.js visualization.

---

## 1. Dataset Files Inspected

The following primary oceanographic and bathymetric NetCDF datasets exist in the project and were inspected with `xarray`:

1. **Local High-Resolution Model Datasets (`data/model/`)**:
   - `data/model/temperature.nc` (46.60 MB) — Primary 4D ocean potential temperature model.
   - `data/model/salinity.nc` (46.60 MB) — Primary 4D practical salinity model.
   - `data/model/currents.nc` (93.18 MB) — Primary 4D ocean current velocities ($u, v$).
   - `data/model/baymetry.nc` (1.25 MB) — Model seabed depth and 3D land/water mask.
   - `data/model/sea level.nc` (1.46 MB) — Sea surface height model ($zos$).
   - `data/model/sea surface temp anamoly.nc` (1.46 MB) — Sea surface temperature anomaly ($ssta$).
2. **Bathymetry Dataset (`data/`)**:
   - `data/gebco_2026_indian_ocean_region.nc` (242.55 MB) — High-resolution GEBCO 2026 global bathymetry grid.
3. **External CMEMS Datasets (`data/external/ocean/`)**:
   - 677 regional NetCDF files downloaded from Copernicus Marine Service (CMEMS GLO12).

---

## 2. Dataset Dimensions & Coordinates

### `data/model/temperature.nc`
- **Dimensions**: `{'time': 40, 'depth': 32, 'latitude': 90, 'longitude': 106}`
- **Coordinates**:
  - `time`: 40 daily time steps (`2026-08-01` to `2026-09-09`), dtype `datetime64[ns]`
  - `depth`: 32 vertical levels, dtype `float32`, units `m`, axis `Z`, positive `down`
  - `latitude`: 90 grid points ($16.08^\circ\text{N}$ to $23.50^\circ\text{N}$), dtype `float32`, units `degrees_north`
  - `longitude`: 106 grid points ($84.17^\circ\text{E}$ to $92.92^\circ\text{E}$), dtype `float32`, units `degrees_east`
- **Data Variable**: `thetao` (Sea Water Potential Temperature)
  - Dimensions: `('time', 'depth', 'latitude', 'longitude')`
  - Shape: `(40, 32, 90, 106)`
  - Total Data Points: $40 \times 32 \times 90 \times 106 = 12,211,200$
  - Dtype: `float32`
  - Units: `degrees_C`
  - Min: `8.18 °C`, Max: `31.25 °C`

### `data/model/salinity.nc`
- **Dimensions**: `{'time': 40, 'depth': 32, 'latitude': 90, 'longitude': 106}`
- **Coordinates**: `time` (40), `depth` (32), `latitude` (90), `longitude` (106)
- **Data Variable**: `so` (Sea Water Salinity)
  - Dimensions: `('time', 'depth', 'latitude', 'longitude')`
  - Shape: `(40, 32, 90, 106)`
  - Dtype: `float32`
  - Units: `1e-3` (Practical Salinity Units, PSU)
  - Min: `18.25 PSU`, Max: `35.48 PSU`

### `data/model/currents.nc`
- **Dimensions**: `{'time': 40, 'depth': 32, 'latitude': 90, 'longitude': 106}`
- **Coordinates**: `time` (40), `depth` (32), `latitude` (90), `longitude` (106)
- **Data Variables**: `uo` (Zonal velocity), `vo` (Meridional velocity)
  - Dimensions: `('time', 'depth', 'latitude', 'longitude')`
  - Shapes: `(40, 32, 90, 106)` each

---

## 3. Depth Coordinate Details

- **Coordinate Name**: `depth`
- **Number of Depth Levels**: `32`
- **Minimum Depth**: `0.494025 m`
- **Maximum Depth**: `541.088928 m`
- **Units**: `m` (meters)
- **Positive Direction**: `down` (positive downward)
- **Standard Name**: `depth`
- **Axis**: `Z`
- **Complete List of 32 Discrete Vertical Levels**:
  ```text
  [0.49, 1.54, 2.65, 3.82, 5.08, 6.44, 7.93, 9.57, 11.40, 13.47, 
   15.81, 18.50, 21.60, 25.21, 29.44, 34.43, 40.34, 47.37, 55.76, 65.81, 
   77.85, 92.33, 109.73, 130.67, 155.85, 186.13, 222.48, 266.04, 318.13, 380.21, 
   453.94, 541.09] meters
  ```

---

## 4. Real Vertical Profiles Extracted from Raw Data

Extracted directly from `data/model/temperature.nc` and `data/model/salinity.nc` at central coordinate **Lat 19.83°N, Lon 88.58°E** (Bay of Bengal) on **2026-08-01**:

| Depth (m) | Temperature (°C) | Salinity (PSU) | Physical Oceanographic Regime |
|---|---|---|---|
| **0.49** | 28.83 | 26.94 | Surface Mixed Layer (Warm, River-influenced Freshwater) |
| **1.54** | 28.83 | 26.94 | Surface Mixed Layer |
| **2.65** | 28.83 | 26.94 | Surface Mixed Layer |
| **3.82** | 28.83 | 26.94 | Surface Mixed Layer |
| **5.08** | 28.83 | 26.94 | Surface Mixed Layer |
| **6.44** | 28.82 | 26.94 | Surface Mixed Layer |
| **7.93** | 28.81 | 26.94 | Surface Mixed Layer |
| **9.57** | 28.80 | 26.95 | Top of Halocline / Thermocline |
| **11.40** | 28.73 | 27.06 | Upper Thermocline |
| **13.47** | 28.69 | 27.69 | Strong Halocline Gradient |
| **15.81** | 28.65 | 29.64 | Halocline |
| **18.50** | 28.46 | 31.45 | Halocline |
| **21.60** | 28.11 | 32.50 | Halocline |
| **25.21** | 27.66 | 33.03 | Halocline |
| **29.44** | 27.17 | 33.36 | Main Thermocline |
| **34.43** | 26.72 | 33.54 | Main Thermocline |
| **40.34** | 26.32 | 33.67 | Main Thermocline |
| **47.37** | 25.78 | 33.85 | Main Thermocline |
| **55.76** | 25.05 | 34.06 | Main Thermocline |
| **65.81** | 24.03 | 34.28 | Permanent Thermocline |
| **77.85** | 22.56 | 34.51 | Permanent Thermocline |
| **92.33** | 20.62 | 34.71 | Permanent Thermocline |
| **109.73** | 18.67 | 34.84 | Subsurface Water Mass |
| **130.67** | 16.97 | 34.90 | Subsurface Water Mass |
| **155.85** | 15.49 | 34.94 | Intermediate Water |
| **186.13** | 14.02 | 34.97 | Intermediate Water |
| **222.48** | 12.82 | 35.00 | Deep Intermediate Water |
| **266.04** | 11.85 | 35.02 | Deep Intermediate Water |
| **318.13** | 11.12 | 35.03 | Deep Sea Water |
| **380.21** | 10.66 | 35.03 | Deep Sea Water |
| **453.94** | 10.28 | 35.04 | Deep Sea Water |
| **541.09** | 9.78 | 35.03 | Deep Sea Water |

- **Temperature Profile Range**: $28.83^\circ\text{C} \to 9.78^\circ\text{C}$ ($\Delta T = 19.06^\circ\text{C}$)
- **Salinity Profile Range**: $26.94\text{ PSU} \to 35.04\text{ PSU}$ ($\Delta S = 8.10\text{ PSU}$)
- **Valid Levels**: $32 / 32$

---

## 5. End-to-End Data Pipeline Architecture & Stage Comparison

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. SOURCE NetCDF (data/model/temperature.nc)                │
│    Dimensions: ('time', 'depth', 'latitude', 'longitude')   │
│    Shape: (40, 32, 90, 106) — TRUE 4D CONTINUOUS DATA       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BACKEND ADAPTER (incois_adapter.py / data_collector.py)  │
│    • When depth=None: extracts 3D array (32, 90, 106)       │
│    • When depth=50m: extracts 2D slice (90, 106) at 50m     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. API ENDPOINT (/api/data/ocean/bundle or /api/data/ocean) │
│    • Local Mode (INCOIS): returns 3D array [32][90][106]    │
│    • Copernicus Mode: returns 2D surface slice [90][107]    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. FRONTEND RECEIVER (app.js -> scalar.js)                  │
│    • Receives JSON payload with 3D or 2D values array       │
│    • is3D = Array.isArray(vals[0][0])                       │
│    • findDepthIndex(depthLevels, depthM)                    │
│    • Extracts 2D horizontal slice vals[dIdx] at depthM      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. THREE.JS RENDERING (water.js: recolorCells())            │
│    • Evaluates bilinear interpolation of 2D slice           │
│    • InstancedMesh calls setColorAt(i, scalarColor)         │
│    • Paints cell instance with color at selected depth      │
└─────────────────────────────────────────────────────────────┘
```

| Pipeline Stage | Has Depth Dimension? | Dimensions / Shape | Data Type / Representation |
|---|---|---|---|
| **1. NetCDF Source (`data/model/`)** | **YES** | `('time', 'depth', 'lat', 'lon')` $\to$ `(40, 32, 90, 106)` | True 4D Oceanographic Grid |
| **2. xarray Dataset** | **YES** | `32` depth levels ($0.49\text{m} \to 541.09\text{m}$) | Float32 `thetao`, `so`, `uo`, `vo` |
| **3. Backend Internal Processing** | **YES** | Retains all 32 depth levels when `depth=None` | NumPy array `(32, 90, 106)` |
| **4. API Response (`/api/data/ocean/bundle`)** | **YES** *(INCOIS)* / **NO** *(Copernicus)* | `values`: `[32][90][106]` *(INCOIS)* or `[90][107]` *(Copernicus)* | JSON 3D nested array + `metadata.depth_levels` |
| **5. Frontend Received Data (`app.js`)** | **YES** | Stored in `this.bundleCache[timeIso]` as 3D array | JavaScript Array of Arrays |
| **6. Three.js Render Target (`scalar.js`)** | **SLICED** | Extracts 2D slice `vals[dIdx]` for active slider depth | Applied to `InstancedMesh.setColorAt(i, col)` |

---

## 6. Where Depth is Handled in the Frontend

1. When scalar visualization is active (e.g. Temperature or Salinity selected in the UI), [`frontend/visualization/scalar.js`](file:///mnt/data/Code/Solvx%20-%20SIH/solvx-viewer/frontend/visualization/scalar.js#L221-L253) checks if `vals` is 3D:
   ```javascript
   const is3D = Array.isArray(vals[0]) && Array.isArray(vals[0][0]);
   const depthLevels = this.currentData.metadata?.depth_levels;
   let dIdx = 0;
   if (is3D && depthLevels && depthLevels.length > 0) {
       dIdx = findDepthIndex(depthLevels, depthM);
   }
   const grid = is3D ? vals[dIdx] : vals;
   ```
2. The user can interact with the **Depth Control slider** (`DepthControl.js`) to view temperature/salinity at different depth levels ($0\text{m}, 10\text{m}, 50\text{m}, 100\text{m}, 250\text{m}, 500\text{m}$).
3. When bathymetric volume mode is active without scalar overlays, [`frontend/scene/water.js`](file:///mnt/data/Code/Solvx%20-%20SIH/solvx-viewer/frontend/scene/water.js) renders the continuous 3D water-column gradient via the GPU shader (`vColumnDepth`).

---

## 7. Final Verdict

Based on exhaustive inspection of raw NetCDF files, backend routing, and frontend pipelines:

[TRUE_3D_DATA_AVAILABLE]
