# SolvX Ocean Data Sources & Architecture Specification

This document specifies the scientific ocean data providers, access protocols, variable mappings, bounding-box subsetting rules, elevation conventions, and error-handling policies integrated into the **SolvX Central Data Architecture**.

---

## 1. Provider Matrix & Coverage

SolvX unifies access across four international oceanographic data centers for dynamic physical variables, paired with **GEBCO** as the authoritative source for seabed topography:

| Provider | Full Name / Institution | Primary Access Protocol | Spatial Coverage | Supported Variables | Auth Requirements |
|---|---|---|---|---|---|
| **`INCOIS`** | Indian National Centre for Ocean Information Services (MoES India) | ERDDAP REST (`griddap`), Local NetCDF fallback | Indian Ocean Basin ($30^\circ\text{S} - 30^\circ\text{N}$, $40^\circ\text{E} - 110^\circ\text{E}$) | `temperature`, `salinity`, `currents`, `sea_surface_height`, `sea_level_anomaly`, `mixed_layer_depth`, `tropical_cyclone_heat_potential`, `chlorophyll` | None for public endpoints; Optional API key |
| **`COPERNICUS`** | Copernicus Marine Service (CMEMS / Mercator Ocean) | ERDDAP REST (`griddap`), OPeNDAP, WMS | Global Oceans ($1/12^\circ \approx 8\text{ km}$ resolution) | `temperature`, `salinity`, `currents`, `sea_surface_height` | Basic Auth credentials (`COPERNICUS_USERNAME`, `COPERNICUS_PASSWORD`) |
| **`NOAA`** | National Oceanic and Atmospheric Administration (CoastWatch / NCEI) | ERDDAP REST (`griddap`) | Global Oceans (Blended satellite & in-situ analyses) | `temperature`, `salinity`, `currents`, `sea_surface_height` | None |
| **`HYCOM`** | Hybrid Coordinate Ocean Model Consortium | THREDDS Data Server (NCSS NetCDF Subset Service) | Global Oceans ($1/12^\circ$ resolution) | `temperature`, `salinity`, `currents`, `sea_surface_height` | None; Concurrency rate-limited (`BoundedSemaphore(2)`) |
| **`GEBCO`** | General Bathymetric Chart of the Oceans (IHO / IOC / Seabed 2030) | Local NetCDF Grid Slicing ($15\text{ arc-sec}$), WCS/DEM service fallback | Global Oceans & Coastal Seas | Seabed Elevation (`elevation`, `rawDepthKm`, `depth`) | None |

---

## 2. Logical Separation of Concerns

To preserve scientific integrity:

1. **Oceanographic Variables vs Bathymetry**:
   - Ocean variables (`temperature`, `salinity`, `currents`, etc.) represent dynamic, time-varying fluid states.
   - Bathymetry represents static numerical seabed elevation.
   - **GEBCO is strictly a bathymetric elevation provider**, never an ocean variable provider. Ocean variables are never mixed with or substituted for bathymetry.
2. **Dynamic Combined Endpoints**:
   - When both ocean variables and seabed geometry are needed simultaneously (e.g. for the 3D WebGL basin viewer), clients call `/api/data/region` or `get_combined_region()`. This bundles the ocean variable payload and the bathymetric elevation payload under distinct keys (`ocean` and `bathymetry`) without conflating their metadata or schemas.

---

## 3. Provider Routing & Strict Error Transparency

SolvX supports both **automatic orchestrator routing** and **explicit provider selection**:

### Automatic Selection (`provider="auto"`)
- Evaluates provider availability, bounding-box geographic coverage, and requested variable.
- For regions inside the Indian Ocean basin with local archives present, `INCOIS` or `LOCAL` is preferred. For global regions, `NOAA`, `COPERNICUS`, or `HYCOM` is routed.
- Normalized response metadata explicitly marks auto-routing:
  ```json
  {
    "requested_provider": "auto",
    "provider": "INCOIS",
    "fallback": false
  }
  ```

### Explicit Provider Selection (`provider="incois" | "copernicus" | "noaa" | "hycom"`)
- When a user or client explicitly requests a provider, SolvX routes strictly to that provider.
- **Strict Error Transparency**: If the explicitly requested provider is unreachable, offline, or returns an error, the request **MUST NOT silently switch to another provider**. Instead, the system raises an explicit `HTTP 502 Bad Gateway` (or `RuntimeError`) containing the upstream failure reason.
- Silent fallback would deceive researchers and analysts regarding the true provenance of scientific measurements.

### Local NetCDF Fallback Mode
- When offline or running in isolated environments without network access, cached or bundled NetCDF files are used.
- Responses served from local files are strictly identified:
  ```json
  {
    "provider": "LOCAL",
    "source_type": "local_netcdf"
  }
  ```
  Local archives are **never** deceptively attributed to NOAA, INCOIS, HYCOM, or Copernicus.

---

## 4. Authoritative Bathymetry: GEBCO 2026 Grid

### Spatial Subsetting
All bathymetric requests are subsetted strictly to the requested bounding box (`min_lat`, `max_lat`, `min_lon`, `max_lon`).

### Downsampling Modes
To optimize bandwidth and WebGL buffer generation across devices, the GEBCO adapter provides 4 downsampling resolutions:
- **`low`**: Downsampled to a target grid of approximately $40 \times 40$ points (~1,600 vertices), ideal for mobile or overview displays.
- **`medium`** (Default): Downsampled to approximately $80 \times 80$ points (~6,400 vertices), balanced for interactive 3D rendering.
- **`high`**: Downsampled to approximately $150 \times 150$ points (~22,500 vertices), providing high-fidelity canyon and trench detail.
- **`native`**: Full native resolution grid slice (up to $15\text{ arc-second}$ resolution).

### Elevation Sign Conventions
SolvX adheres strictly to international hydrographic conventions:
- `elevation`: Signed elevation in meters.
  - **Negative values (e.g. $-2500.0\text{ m}$)**: Sub-surface ocean depth below mean sea level.
  - **Positive values (e.g. $+350.0\text{ m}$)**: Subaerial land elevation above mean sea level.
  - **Zero ($0.0\text{ m}$)**: Mean coastline / sea level.
- `rawDepthKm`: Underwater depth in positive kilometers ($-\text{elevation} / 1000.0$ for underwater points, $0.0$ for land), utilized directly by Three.js vertex shaders.
- `maxDepthKm`: Maximum basin floor depth in kilometers used for vertical scene scaling.
- `depth`: Alias of `elevation` provided for backward compatibility with legacy client scripts.
- **Zero Synthetic Data**: SolvX uses real numerical grids extracted from GEBCO and NOAA DEM datasets. Synthetic parabolic bowls and procedural ocean floor fakes are strictly banned.

---

## 5. Vector Ocean Currents Processing

When querying `variable="currents"`, SolvX fetches eastward velocity ($u$) and northward velocity ($v$) components and computes physically accurate derived fields:

$$ \text{speed} = \sqrt{u^2 + v^2} \quad (\text{m/s}) $$

$$ \text{direction} = \left( \operatorname{atan2}(v, u) \times \frac{180}{\pi} \right) \pmod{360^\circ} \quad (\text{degrees clockwise from North}) $$

Both scalar grids and vector fields are returned in normalized responses:
- `u`: 2D array of zonal velocities ($\text{m/s}$)
- `v`: 2D array of meridional velocities ($\text{m/s}$)
- `speed`: 2D array of current magnitudes ($\text{m/s}$)
- `direction`: 2D array of current heading angles ($^\circ$)

---

## 6. Upstream Rate-Limiting & Concurrency Control

- **HYCOM TDS Rate Limiting**: The HYCOM THREDDS server enforces strict connection caps. The `HYCOMAdapter` wraps all HTTP and NCSS transactions in a Python `threading.BoundedSemaphore(2)` with a 15-second timeout, preventing connection flooding and IP blacklisting.
- **Caching**: Clean BBOX query parameters are hashed (`make_cache_key`) into the memory cache service with configurable TTLs, avoiding redundant round-trips for identical requests.

---

## 7. Central REST API Reference

### Provider Information
- **`GET /api/data/providers`**: Lists all supported providers, coverage areas, capabilities, and variables.
- **`GET /api/data/providers/status`**: Live diagnostic health probe of all external oceanographic and bathymetric data feeds.
- **`GET /api/data/providers/{provider}/variables`**: Lists supported variables for a specific provider.
- **`GET /api/data/providers/{provider}/datasets`**: Returns dataset IDs and configurations for a provider.
- **`GET /api/data/providers/{provider}/metadata`**: Detailed institutional metadata and citation info.

### Oceanographic Variables
- **`GET /api/data/ocean`**:
  Query parameters:
  - `provider`: `auto` (default), `incois`, `copernicus`, `noaa`, `hycom`
  - `variable`: `temperature`, `salinity`, `currents`, `sea_surface_height`, etc.
  - `min_lat`, `max_lat`, `min_lon`, `max_lon`: Bounding box coordinates
  - `depth`: Vertical depth level in meters (optional)
  - `time`: ISO 8601 timestamp string (optional)
  - `stride`: Subsampling step (default: `1`)
- **`POST /api/data/ocean`**:
  JSON request body matching `OceanVariableRequest`:
  ```json
  {
    "provider": "noaa",
    "variable": "temperature",
    "bbox": {
      "min_lat": 16.0,
      "max_lat": 20.0,
      "min_lon": 84.0,
      "max_lon": 88.0
    }
  }
  ```

### Bathymetry & Seabed
- **`GET /api/data/bathymetry`** / **`GET /api/bathymetry`**:
  Query parameters:
  - `min_lat`, `max_lat`, `min_lon`, `max_lon`: Bounding box coordinates
  - `resolution`: `low`, `medium`, `high`, `native` (default: `medium`)
- **`POST /api/data/bathymetry`** / **`POST /api/bathymetry`**:
  JSON request body matching `BathymetryRequest`:
  ```json
  {
    "bbox": {
      "min_lat": 16.0,
      "max_lat": 20.0,
      "min_lon": 84.0,
      "max_lon": 88.0
    },
    "resolution": "medium"
  }
  ```

### Combined Region (Ocean + Bathymetry)
- **`GET /api/data/region`**:
  Query parameters:
  - `provider`: `auto`, `incois`, `copernicus`, `noaa`, `hycom`
  - `variable`: `temperature`, `salinity`, `currents`, etc.
  - `min_lat`, `max_lat`, `min_lon`, `max_lon`: Bounding box
  - `resolution`: Bathymetry resolution (`low`, `medium`, `high`, `native`)
  - `include_bathymetry`: `true` or `false`
- **`POST /api/data/region`**:
  JSON request body matching `CombinedRegionRequest`.
