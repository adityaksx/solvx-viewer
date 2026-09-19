# SolvX — Interactive 3D Ocean Intelligence Platform

SolvX is a web-based scientific ocean visualization and data-analysis platform for exploring the ocean in **2D and 3D across latitude, longitude, depth and time**.

It combines live and cached oceanographic datasets with an interactive Three.js/WebGL scene, bathymetry, observation data, model–observation comparison, anomaly detection and hazard-oriented analysis.

> **Project direction:** SolvX is being developed as a prototype operational intelligence layer toward an Indian Ocean Digital Twin — not simply as another 3D ocean viewer.

---

## What SolvX Does

SolvX turns heterogeneous ocean data into an interactive workflow:

```text
Ocean data
   ↓
Provider routing / collection
   ↓
2D + 3D / 4D visualization
   ↓
Model ↔ observation comparison
   ↓
Anomaly analysis
   ↓
Hazard and decision-support views
```

The platform is designed around the idea that visualization should help the user **understand what is happening in the ocean**, not just display a colored map.

---

## Key Features

### 1. Interactive 2D Region Selection

- Interactive world map for selecting an ocean region.
- Draw a custom bounding box or use predefined basin presets.
- Coordinate validation before data requests.
- Current project presets include:
  - Bay of Bengal
  - Arabian Sea
  - South China Sea
  - Gulf of Mexico
  - Mediterranean Sea

### 2. Interactive 3D Ocean Scene

The selected region is converted into an interactive WebGL ocean scene using **Three.js**.

The scene can display:

- Extruded land and coastlines
- Maritime / EEZ boundaries
- GEBCO bathymetric seabed
- Water volume
- Animated surface waves
- Vertical depth structure
- Scientific scalar fields
- Current vectors
- Animated current particles

Users can orbit, zoom and inspect the ocean volume rather than being limited to a flat surface map.

### 3. Depth-Aware Ocean Visualization

Ocean variables can be inspected through the water column.

Supported interactions include:

- Depth control
- Volume visualization
- Depth slicing
- Custom vertical slice planes
- Vertical exploration from surface toward deeper layers

This allows subsurface structure to be viewed directly.

### 4. Scientific Variables

The backend supports a normalized variable catalogue across multiple providers.

Core variables include:

| Variable | Typical Unit | Visualization |
|---|---|---|
| Temperature | °C | Scalar / 3D |
| Salinity | PSU | Scalar / 3D |
| Currents | m/s | Vectors + particles |
| Sea-surface height | m | Scalar |
| Sea-level anomaly | m | Scalar |
| Mixed-layer depth | m | Scalar |
| Temperature anomaly | °C | Scalar |
| Chlorophyll | mg/m³ | Scalar / 3D |
| Dissolved oxygen | mmol/m³ | Scalar / 3D |
| pH | pH | Scalar / 3D |
| Nitrate | mmol/m³ | Scalar / 3D |
| Phosphate | mmol/m³ | Scalar / 3D |

The exact availability depends on the selected provider and dataset.

### 5. Multiple Ocean Data Providers

SolvX provides a central data layer that can route requests to:

- **INCOIS**
- **Copernicus Marine**
- **NOAA**
- **HYCOM**
- **Local NetCDF archives**

The client can request a specific provider or use:

`provider=auto`

for automatic routing based on provider availability, geographic coverage and variable support.

### 6. GEBCO Bathymetry

The seabed is generated from numerical bathymetric elevation data rather than a synthetic ocean-floor shape.

Bathymetry can be requested at multiple resolutions:

- `low`
- `medium`
- `high`
- `native`

The backend preserves the distinction between:

- **oceanographic variables** — dynamic water-state data
- **bathymetry** — static seabed elevation

### 7. Argo / In-Situ Observation Visualization

SolvX can display in-situ ocean observations inside the selected region.

The current prototype supports:

- Argo float locations
- Vertical float profiles
- Interactive float inspection
- Model profile retrieval
- Observation vs model comparison

Selecting a float can open a profile comparison containing:

- Depth
- Observed temperature
- Model temperature
- Difference
- RMSE
- Mean model bias

This changes the workflow from simply viewing model output to checking **model behaviour against observations**.

### 8. Model–Observation Comparison

A core project objective is:

```text
Observed data ↔ Model data
```

The platform can collocate a model profile with an observed profile and calculate comparison metrics.

Example:

```text
Depth      Observed      Model      Difference
------------------------------------------------
0 m          ...          ...          ...
50 m         ...          ...          ...
100 m        ...          ...          ...
250 m        ...          ...          ...
500 m        ...          ...          ...
```

The prototype also exposes RMSE and bias metrics for profile comparison.

### 9. Multivariate Anomaly Detection

SolvX contains an ML-oriented analysis layer for identifying unusual ocean states from multiple variables.

The anomaly system:

- Extracts spatial features
- Calculates anomaly scores
- Classifies severity
- Identifies variables contributing to an anomaly
- Provides point-level explainability

The intent is to answer:

> **Where does the current ocean state look unusual?**

rather than requiring the user to inspect every variable manually.

### 10. Ocean Hazard / Early-Warning UI

The frontend contains a hazard panel and backend hazard-analysis layer.

The prototype can identify elevated anomaly zones and expose:

- Hazard type
- Risk score
- Risk level
- Predicted center
- Location uncertainty
- Expected window
- Data quality
- Observation coverage
- Missing inputs
- Contributing signals

The current prototype is explicitly **decision-support / analytical**, not an operational warning service.

### 11. Atmospheric + Ocean Point Inspection

Point inspection can combine ocean and atmospheric values where available.

The interface can show fields such as:

- Ocean temperature
- Salinity
- Sea level
- Current velocity and direction
- Air temperature
- Wind velocity and direction
- Relative humidity
- Surface pressure
- Anomaly score
- Hazard risk

### 12. Time-Series / Timeline Exploration

The frontend includes a timeline interface with:

- Historical time state
- Hourly resolution
- Daily resolution
- Monthly resolution
- Play / pause
- Playback speed
- Start/end datetime selection
- Fetch-data workflow

This provides a basic path toward **4D ocean replay**.

### 13. Data Caching and Performance

The backend is designed to avoid repeatedly downloading the same scientific data.

It uses:

- Local NetCDF archives
- In-memory caching
- Cache TTL controls
- Request downsampling / stride
- Thread-safe NetCDF access
- Provider-specific rate/concurrency controls

Large scientific arrays are therefore reduced before being sent to the browser where appropriate.

### 14. Scientific Data Provenance

Provider-specific requests remain explicitly attributed to the source that produced the data.

The architecture distinguishes between:

```text
LIVE / EXTERNAL PROVIDER
LOCAL NETCDF CACHE
```

The system should not silently relabel local or fallback data as another provider.

---

## Architecture

```text
                         ┌──────────────────────────┐
                         │      2D WORLD MAP        │
                         │ Region / BBOX Selection  │
                         └────────────┬─────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │       FastAPI Backend     │
                         │      Central Data API     │
                         └────────────┬─────────────┘
                                      │
                ┌─────────────────────┼──────────────────────┐
                │                     │                      │
                ▼                     ▼                      ▼
        ┌──────────────┐     ┌──────────────┐      ┌────────────────┐
        │   INCOIS     │     │  Copernicus  │      │ NOAA / HYCOM   │
        └──────────────┘     └──────────────┘      └────────────────┘
                │                     │                      │
                └─────────────────────┼──────────────────────┘
                                      │
                                      ▼
                             ┌─────────────────┐
                             │ Normalization / │
                             │  Subsetting /   │
                             │    Caching      │
                             └────────┬────────┘
                                      │
                    ┌─────────────────┼──────────────────┐
                    │                 │                  │
                    ▼                 ▼                  ▼
             Ocean Variables     GEBCO Bathymetry   Observations
                    │                 │                  │
                    └─────────────────┼──────────────────┘
                                      ▼
                         ┌──────────────────────────┐
                         │      Three.js / WebGL    │
                         │       3D Ocean Scene     │
                         └────────────┬─────────────┘
                                      │
                   ┌──────────────────┼──────────────────┐
                   │                  │                  │
                   ▼                  ▼                  ▼
             Visualization      ML Analysis       Hazard UI
             Temperature         Anomalies         Risk zones
             Salinity            Explainability    Signals
             Currents             Comparison       Uncertainty
             Depth / Time
```

---

## Technology Stack

### Frontend

- HTML5
- CSS3
- JavaScript ES Modules
- **Three.js**
- WebGL
- Interactive 2D map and region-selection UI

### Backend

- Python
- **FastAPI**
- **Uvicorn**
- NumPy
- Pandas
- Xarray
- netCDF4
- GeoPandas
- Shapely

### Scientific Data

- NetCDF
- Copernicus Marine datasets
- INCOIS / ERDDAP
- NOAA / ERDDAP
- HYCOM
- GEBCO bathymetry
- Argo / in-situ observations

### Analysis

- Spatial feature extraction
- Multivariate anomaly detection
- Model–observation collocation
- RMSE / bias calculations
- Hazard scoring

---

## Repository Structure

```text
solvx-viewer/
├── backend/
│   ├── api/
│   │   ├── data.py              # Central provider/data APIs
│   │   ├── download.py          # Data download endpoints
│   │   ├── geography.py         # Geography endpoints
│   │   ├── bathymetry.py        # Bathymetry endpoints
│   │   ├── ocean.py             # Ocean APIs
│   │   ├── observations.py      # In-situ observation APIs
│   │   ├── region.py            # Region selection/validation
│   │   └── ml.py                # ML/anomaly endpoints
│   │
│   ├── adapters/
│   │   ├── copernicus_adapter.py
│   │   ├── incois_adapter.py
│   │   ├── noaa_adapter.py
│   │   ├── hycom_adapter.py
│   │   ├── bathymetry_adapter.py
│   │   ├── geography_adapter.py
│   │   └── observation_adapter.py
│   │
│   ├── ml/
│   │   ├── anomaly_detector.py
│   │   ├── feature_engineering.py
│   │   ├── hazard_model.py
│   │   ├── predictor.py
│   │   └── schemas.py
│   │
│   ├── processing/
│   │   ├── coordinate_utils.py
│   │   ├── interpolation.py
│   │   ├── normalization.py
│   │   └── subset.py
│   │
│   ├── services/
│   │   ├── data_collector.py
│   │   ├── ocean_data_service.py
│   │   ├── observation_service.py
│   │   ├── bathymetry_service.py
│   │   ├── geography_service.py
│   │   ├── download_service.py
│   │   ├── eez_service.py
│   │   └── cache_service.py
│   │
│   ├── config.py
│   └── main.py
│
├── frontend/
│   ├── app.js
│   ├── index.html
│   ├── styles.css
│   │
│   ├── api/
│   ├── controls/
│   ├── map/
│   ├── scene/
│   ├── ui/
│   └── visualization/
│
├── data/
├── docs/
├── scripts/
├── tests/
├── package.json
├── requirements.txt
├── run.py
└── .env.example
```

---

## Installation

### Prerequisites

Install:

- **Python 3.10+**
- **pip**
- **Git**
- A modern web browser with WebGL support

Node.js is only needed for repository tooling such as the Puppeteer dependency; the main application itself is launched with Python.

---

## 1. Clone the Repository

```bash
git clone https://github.com/adityaksx/solvx-viewer.git
cd solvx-viewer
```

---

## 2. Create a Python Virtual Environment

### Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### Windows PowerShell

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

---

## 3. Install Python Dependencies

```bash
pip install -r requirements.txt
```

This installs the application's current Python stack:

```text
fastapi
uvicorn
numpy
pandas
xarray
netCDF4
geopandas
shapely
```

---

## 4. Optional: Install Node Dependencies

The repository also contains a `package.json` with Puppeteer.

```bash
npm install
```

This is not required for the normal `python run.py` application startup.

---

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

The repository currently includes environment variables for:

- Copernicus Marine credentials
- INCOIS API/auth configuration
- NOAA endpoint configuration
- Request timeouts
- Cache size / TTL
- Local-data mode

Example:

```env
COPERNICUSMARINE_SERVICE_USERNAME=
COPERNICUSMARINE_SERVICE_PASSWORD=
```

Do **not** commit real credentials to GitHub.

---

## Running SolvX

The easiest way to start the complete application is:

```bash
python run.py
```

The launcher starts:

- **Frontend:** http://127.0.0.1:5500
- **Backend API:** http://127.0.0.1:8080
- **FastAPI Swagger UI:** http://127.0.0.1:8080/docs

Open:

```text
http://127.0.0.1:5500
```

The `run.py` launcher runs the FastAPI server and a lightweight HTTP server for the frontend together.

---

## Running the Backend Separately

For backend development:

```bash
uvicorn backend.main:app --host 127.0.0.1 --port 8080
```

Then open:

```text
http://127.0.0.1:8080/docs
```

---

## API Overview

The central data router is available under:

```text
/api/data
```

### Provider APIs

```http
GET /api/data/providers
GET /api/data/providers/status
GET /api/data/providers/{provider}/variables
GET /api/data/providers/{provider}/datasets
GET /api/data/providers/{provider}/metadata
```

### Ocean Data

```http
GET  /api/data/ocean
POST /api/data/ocean
GET  /api/data/ocean/bundle
GET  /api/data/ocean/check
GET  /api/data/ocean/{variable}
```

Typical parameters include:

```text
provider
variable
min_lat
max_lat
min_lon
max_lon
depth
time
stride
resolution
```

### Combined Region

```http
GET  /api/data/region
POST /api/data/region
```

This can combine ocean data with bathymetry for 3D rendering.

### Bathymetry

```http
GET  /api/data/bathymetry
POST /api/data/bathymetry
```

Supported resolution modes:

```text
low
medium
high
native
```

### Geometry

```http
GET /api/data/geometry
```

### Variables

```http
GET /api/data/variables
```

Additional legacy / compatibility APIs remain available under the older `/api/ocean`, `/api/region`, `/api/geography` and related routes.

The complete interactive API specification is available through Swagger:

**http://127.0.0.1:8080/docs**

---

## Typical Usage

A normal exploration workflow is:

```text
1. Open SolvX
       ↓
2. Select an ocean region
       ↓
3. Choose a provider
       ↓
4. Select a variable
       ↓
5. Select time / depth
       ↓
6. Load the 3D ocean scene
       ↓
7. Inspect temperature / salinity / currents
       ↓
8. Inspect Argo observations
       ↓
9. Compare observation with model
       ↓
10. Examine anomalies / hazard signals
```

---

## Testing

The repository contains an automated test suite covering API behaviour, data processing, provider logic and concurrency-related behaviour.

Run:

```bash
python -m unittest tests/test_all.py
```

Additional provider/data tests are available under:

```text
tests/
├── test_all.py
├── test_data_collector.py
└── test_ocean_providers.py
```

---

## Important Data / Scientific Notes

### Provider transparency

When a provider is explicitly selected, SolvX is designed to return an error instead of silently replacing that provider with another source when the requested upstream service fails.

This matters because scientific provenance should remain visible.

### Local data mode

SolvX can use cached or locally available NetCDF data when appropriate.

Local data is identified as local data and should not be presented as if it came directly from an external provider.

### Bathymetry is separate from ocean state

GEBCO is used for seabed elevation. It is not treated as an oceanographic variable.

### Prototype hazard analysis

The anomaly and hazard systems are prototype analytical components. Their results should not be treated as official operational warnings or forecasts.

---

## Project Goals

SolvX is being developed around six layers:

### Explore

Interactive 2D/3D ocean visualization.

### Observe

Bring Argo and other in-situ measurements into the same spatial context.

### Compare

Automatically compare model output with observations.

### Diagnose

Expose anomalies, bias, uncertainty and observation gaps.

### Decide

Provide decision-oriented workflows such as hazard-oriented exploration.

### Explain

Build toward a scientific query layer that can explain the selected ocean state using the available data.

The intended progression is:

```text
DATA
  ↓
VISUALIZATION
  ↓
OBSERVATION
  ↓
COMPARISON
  ↓
ANOMALY
  ↓
ANALYSIS
  ↓
DECISION SUPPORT
```

---

## Roadmap Direction

Possible future extensions include:

- Ocean replay for major events
- Stronger uncertainty visualization
- Observation-density / blind-spot maps
- Observation-placement decision support
- Dedicated cyclone / oil-spill / search-and-rescue workflows
- Scientific question mode
- Data-grounded AI assistant
- More in-situ sources such as gliders, buoys and CTD profiles
- Expanded model–observation validation
- Toward an Indian Ocean Digital Twin workflow

---

## Data Sources

The project architecture currently references and integrates:

- Copernicus Marine Service
- INCOIS / ERDDAP
- NOAA data services
- HYCOM
- GEBCO bathymetry
- Argo / in-situ observations
- Local NetCDF datasets

See the detailed provider and architecture documentation:

```text
docs/data_sources.md
```

---

## Copernicus Marine Credentials

**Important:** To fetch live data from **Copernicus Marine**, you need valid Copernicus Marine credentials.

Create your credentials configuration using:

```env
COPERNICUSMARINE_SERVICE_USERNAME=YOUR_USERNAME
COPERNICUSMARINE_SERVICE_PASSWORD=YOUR_PASSWORD
```

The application can discover credentials from the environment and from the Copernicus Marine credentials file used by the adapter.

For security:

- Never hard-code your username/password in source files.
- Never commit `.env` or credential files to Git.
- Keep credentials local to your machine or deployment environment.

Without valid Copernicus credentials, Copernicus-backed live data requests may return a missing-credentials / authentication error. Other providers or locally cached data may still be available depending on the selected region, variable and configuration.

---

## License

The repository currently declares the **ISC** license in `package.json`.
