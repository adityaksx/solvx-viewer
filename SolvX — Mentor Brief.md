# SolvX — SIH Project Brief

## 1. Problem
- SIH Problem Statement: **SIH26067**
- Ocean data such as temperature, salinity, currents, chlorophyll etc. is available in large multidimensional datasets like NetCDF.
- Data also comes from **Argo floats and Gliders**.
- Existing platforms can visualize ocean data, but **model data and real observations are not easy to compare in one workflow**.
- Users have to manually analyze different datasets to identify where the model differs from reality.

## 2. Our Solution
- **SolvX — 3D Ocean Explorer**
- Web-based interactive platform for exploring ocean model data in 3D.
- Integrates **ocean model + Argo/Glider observations**.
- Users can explore variables across **location, depth and time**.
- Select an observation and compare it with the corresponding model data.
- Calculate and visualize **difference, bias and RMSE**.
- Goal: move from simply **visualizing data → understanding model accuracy and anomalies**.

## 3. What is Unique
- **Model vs Reality:** direct comparison between model predictions and actual observations.
- **Error/Bias visualization:** identify where and at what depth the model differs from observations.
- **Depth-aware exploration:** analyze ocean conditions from surface to deeper levels.
- **Anomaly/uncertainty analysis:** identify regions requiring further investigation.
- **Decision-focused workflows:** potential modes for cyclone, SAR, oil spill and fisheries applications.
- Main idea: **not just another 3D ocean viewer, but an analysis layer over ocean visualization.**

## 4. Architecture
- **Data:** NetCDF ocean model data + Argo/Glider observations + bathymetry/geographical data.
- **Processing:** Python + xarray + NumPy for reading, validating, subsetting and processing data.
- **Backend:** FastAPI REST APIs for spatial, depth and time-based data access and model-observation comparison.
- **Frontend:** React/Next.js + Three.js/WebGL for interactive 3D visualization.
- **Performance:** server-side subsetting, downsampling and caching to avoid sending huge datasets to the browser.

## 5. Current Status
- NetCDF data access
- 3D ocean visualization
- Depth exploration
- Argo overlay and point inspection
- Model-observation comparison
- RMSE/Bias analysis

## 6. What We Need From the Mentor
- Validate our **model-observation comparison methodology**.
- Guidance on appropriate scientific metrics and data matching.
- Which features/use cases are actually valuable for operational oceanography.
- Suggestions to make SolvX scientifically credible and practically useful.