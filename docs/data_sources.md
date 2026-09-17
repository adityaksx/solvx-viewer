# SolvX Ocean Data Sources & Collector Architecture

This document specifies the scientific data sources, access mechanisms, variables, spatial/temporal coverage, and normalization protocols integrated into the **SolvX Central Data Collector API**.

---

## Executive Summary: Data Sources & Provenance Table

| Data Category | Authoritative Source | Access Method | Real / API Status |
|---|---|---|---|
| **Ocean Temperature** | INCOIS (HOOFS Model) / MoES India | ERDDAP REST (`griddap`) / Local NetCDF Fallback | Real Scientific Data (Live ERDDAP + Verified Local NetCDF Archive) |
| **Ocean Salinity** | INCOIS (HOOFS Model) / MoES India | ERDDAP REST (`griddap`) / Local NetCDF Fallback | Real Scientific Data (Live ERDDAP + Verified Local NetCDF Archive) |
| **Ocean Currents ($u, v$)** | INCOIS (HOOFS Model) / MoES India | ERDDAP REST (`griddap`) / Local NetCDF Fallback | Real Scientific Data (Live ERDDAP + Verified Local NetCDF Archive) |
| **Sea Surface Height / SLA** | INCOIS (HOOFS Model) / MoES India | ERDDAP REST (`griddap`) / Local NetCDF Fallback | Real Scientific Data (Live ERDDAP + Verified Local NetCDF Archive) |
| **Seabed Bathymetry** | GEBCO 2023 Grid / NOAA NCEI DEM | NetCDF Grid Slicing ($0.083^\circ$) | Real Scientific Data (Verified Local GEBCO Grid) |
| **Maritime EEZ Boundaries** | Marine Regions / Flanders Marine Institute (VLIZ) v12 | Shapefile Vector Query (`eez_v12_lowres.shp`) | Real Maritime Boundaries (World EEZ v12 GeoJSON & 3D Vectors) |
| **Land & Minor Islands** | Natural Earth 1:10m Physical & Minor Islands | Shapefile Vector Slicing (`ne_10m_land`, `ne_10m_minor_islands`) | Real Geographic Geometry (Extruded 3D Land & Islands) |
| **Coastline Shorelines** | Natural Earth 1:10m Coastline Vectors | Shapefile Vector Slicing (`ne_10m_coastline`) | Real Geographic Geometry (3D Shoreline Lines) |
| **In-Situ Argo Profiles** | INCOIS Indian Ocean Argo Float Program | NetCDF / JSON In-Situ Sounding Catalog | Real In-Situ Observations (Depth Profiles & Collocation Comparison) |

---

## 1. INCOIS (Indian National Centre for Ocean Information Services)

INCOIS is the **primary authoritative provider** for oceanographic and marine meteorological data in SolvX.

### Overview
- **Institution**: INCOIS (Ministry of Earth Sciences, Govt. of India)
- **Portal**: [https://incois.gov.in](https://incois.gov.in)
- **Data Server (ERDDAP)**: `https://erddap.incois.gov.in/erddap`
- **Catalog Server (THREDDS / LAS)**: `https://las.incois.gov.in/thredds/catalog/`
- **Access Protocol**: ERDDAP `griddap` (gridded fields) & `tabledap` (tabular/in-situ), OPeNDAP

### Supported Physical Variables & Mapping

| SolvX Variable | INCOIS Dataset ID | Internal Variable Names | Units | Vertical Levels | Description |
|---|---|---|---|---|---|
| `temperature` | `incois_hoofs_temp` | `temperature`, `temp`, `sst` | °C | 0 to 5000m (40 levels) | Sea Water Potential Temperature |
| `salinity` | `incois_hoofs_sal` | `salinity`, `salt`, `so` | PSU | 0 to 5000m (40 levels) | Practical Salinity Units |
| `currents` | `incois_hoofs_curr` | `uo`, `vo` ($u, v$ vectors) | m/s | 0 to 5000m (40 levels) | Horizontal Ocean Velocity |
| `sea_surface_height` | `incois_hoofs_ssh` | `zos`, `ssh`, `total_sea_level` | m | Surface only | Sea Surface Height above geoid |
| `sea_level_anomaly` | `incois_hoofs_sla` | `sla` | m | Surface only | Sea Surface Height Anomaly |
| `mixed_layer_depth` | `incois_hoofs_mld` | `mld` | m | Surface only | Ocean Mixed Layer Thickness |
| `tropical_cyclone_heat_potential` | `incois_hoofs_tchp` | `tchp` | kJ/cm² | Surface only | Tropical Cyclone Heat Potential |
| `chlorophyll` | `incois_ocm_chl` | `chlorophyll`, `chl` | mg/m³ | Surface only | Chlorophyll-a Concentration |

### Query Construction
- **ERDDAP Griddap Syntax**:
  ```text
  GET /griddap/{dataset_id}.json?{variable}[(time)][(depth)][(min_lat):(max_lat)][(min_lon):(max_lon)]
  ```
- **Current Vector Normalization**:
  $$ \text{speed} = \sqrt{u^2 + v^2} $$
  $$ \text{direction} = \left( \text{atan2}(v, u) \times \frac{180}{\pi} \right) \pmod{360^\circ} $$

### Limitations & Authentication
- INCOIS public datasets do not require authentication for basic ERDDAP read queries. High-frequency or bulk downloads may require an API token or credentials via environment variables:
  ```env
  INCOIS_BASE_URL=https://erddap.incois.gov.in/erddap
  INCOIS_API_KEY=
  INCOIS_USERNAME=
  INCOIS_PASSWORD=
  ```
- When running in offline or sandbox environments without internet egress, SolvX automatically switches to `LOCAL_DATA_MODE=true` to serve calibrated local NetCDF archives seamlessly.

---

## 2. Bathymetry / Seabed Sources

### Overview
- **Source**: GEBCO (General Bathymetric Chart of the Oceans) / NOAA NCEI DEM Global Mosaic
- **Resolution**: $0.083^\circ$ (~9 km) down to $15$ arc-second grids
- **Units**: Elevation/Depth in meters
- **3D Normalization**:
  - `depth`: array in meters (negative below sea level, positive above)
  - `rawDepthKm`: array in kilometers (positive underwater depth)
  - `maxDepthKm`: maximum basin floor depth for vertical scaling

---

## 3. Geographic Land & Coastline Geometry

### Overview
- **Source**: Natural Earth 1:10,000,000 Physical Vectors / OpenStreetMap
- **Layers**:
  - `land`: Extruded 3D land polygons with top, side skirts, and bedrock slab
  - `coast`: High-precision shoreline line strings
  - `eezBeads`: Maritime Exclusive Economic Zone (EEZ) boundary markers spaced at 18 km
- **Format**: Three.js-ready JSON coordinates projected into regional Easting/Northing kilometers

---

## 4. In-Situ Observations (Argo Floats)

### Overview
- **Source**: INCOIS Indian Ocean Argo Program / Coriolis / OceanOPS
- **Parameters**: CTD (Conductivity, Temperature, Depth) vertical profiles down to 1000m–2000m
- **Collocation & Comparison**:
  - Vertically interpolates model temperature/salinity levels against exact Argo observation soundings.
  - Computes statistical validation metrics:
    $$ \text{RMSE} = \sqrt{\frac{1}{N} \sum_{i=1}^N (M_i - O_i)^2} $$
    $$ \text{Bias} = \frac{1}{N} \sum_{i=1}^N (M_i - O_i) $$

---

## 5. Strict Separation: Scientific Data vs Visual Effects

| Layer | Type | Source | Description |
|---|---|---|---|
| **Temperature / Salinity / Currents / SSH** | **Real Scientific Data** | INCOIS / NetCDF Models | Exact physical quantities, units, and coordinates |
| **Seabed Bathymetry** | **Real Scientific Data** | GEBCO / NOAA DEM | Measured seabed elevation |
| **Coastlines & Land** | **Real Geographic Data** | Natural Earth 10m | Real world shoreline vectors |
| **Argo Float Profiles** | **Real Observational Data**| INCOIS Argo Program | Calibrated in-situ CTD profiles |
| **Water Wave Displacement** | *Procedural Visual* | Three.js Shader | Sinusoidal wave animation (visual-only) |
| **Seabed Seagrass / Rocks** | *Procedural Visual* | Three.js Procedural | Depth-scattered seabed decoration (visual-only) |
| **Atmospheric Glow** | *Procedural Visual* | Three.js Shader | Planet rim illumination effect (visual-only) |
