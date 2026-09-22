# SolvX Viewer Performance Baseline

Recorded on initial setup before performance and stability optimizations.

## System & Environment
- **Date**: 2026-09-22
- **Python**: 3.14 (.venv)
- **FastAPI / Uvicorn**: 0.141.1 / 0.53.0
- **xarray / netCDF4**: 2026.7.0 / 1.7.4

## Baseline Metrics

### Memory & Startup
- **Startup Time**: ~0.36 ms (app initialization)
- **Initial RSS Memory**: 157.03 MB
- **Post-Query RSS Memory**: 278.28 MB (+121.25 MB after simple query suite)

### Endpoint Latencies & Payload Sizes (Pre-Optimization)

| Endpoint | Method | Cold Latency (ms) | Avg Warm Latency (ms) | P95 Warm (ms) | Payload Size (bytes) | Notes |
|---|---|---|---|---|---|---|
| `/health` | GET | 102.44 | 2.17 | 3.08 | 38 B | Fast health check |
| `/api/ocean/catalog` | GET | 2.38 | 1.96 | 2.29 | 1.6 KB | Variable catalog metadata |
| `/api/ocean/time` | GET | 708.48 | 5.80 | 8.87 | 947 B | NetCDF time coordinate scan |
| `/api/ocean/current-grid` | GET | 13.84 | 8.69 | 9.29 | 34.6 KB | U/V vector grid |
| `/api/ocean/point` | GET | 1995.13 | 1751.09 | 1991.32 | 540 B | Multi-provider point inspection |
| `/api/geography` | GET | 129.93 | 53.29 | 61.17 | 553.3 KB | Uncompressed land/coast vectors |
| `/api/bathymetry` | GET | 278.59 | 203.12 | 207.30 | 4.48 MB | Uncompressed GEBCO depth grid |
| `/api/ocean/query` (Bundle) | POST | 927.32 | 381.99 | 390.02 | 7.96 MB | Uncompressed multi-variable bundle |

### Key Issues Identified in Baseline
1. **Uncompressed High-Volume Payloads**: `bathymetry` (4.48MB) and `ocean_bundle` (7.96MB) transfer raw JSON text without HTTP compression.
2. **Process-Wide NetCDF Serialization**: `NETCDF_LOCK` locks the entire dataset on every read and `safe_open_dataset` call, stalling concurrent requests.
3. **Point Inspection Latency**: Point query takes ~1.8s even on warm cache due to sequential multi-provider and disk calls.
4. **Current Particle System Complexity**: Particle motion runs an $O(N)$ linear loop over coordinate grids for every particle on every frame in JavaScript.
5. **Memory Churn**: Full volume sorting in frontend scalar visualization during slider scrub.
