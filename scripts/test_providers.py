#!/usr/bin/env python3
"""
SolvX Multi-Provider Diagnostic Script
======================================
Tests connectivity, latency, and operational health across all supported
SolvX oceanographic and bathymetric data providers:
1. INCOIS (Indian National Centre for Ocean Information Services)
2. Copernicus Marine Service (CMEMS / Mercator Ocean)
3. NOAA CoastWatch / OceanWatch ERDDAP
4. HYCOM Consortium THREDDS Data Server
5. GEBCO Bathymetry (Authoritative Seabed Elevation)
"""
import os
import sys
import time
import json
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from backend.adapters import (
    INCOISAdapter, NOAAAdapter, CopernicusAdapter, HYCOMAdapter, GEBCOAdapter
)
from backend.services.data_collector import COLLECTOR

def test_all_providers():
    print("=" * 80)
    print(" SolvX Multi-Provider Diagnostic Suite")
    print("=" * 80)
    print("Checking live connectivity, latency, and status across all scientific feeds...\n")
    adapters = {
        "INCOIS": INCOISAdapter(),
        "NOAA": NOAAAdapter(),
        "Copernicus Marine": CopernicusAdapter(),
        "HYCOM": HYCOMAdapter(),
        "GEBCO": GEBCOAdapter()
    }
    results = []
    for name, adapter in adapters.items():
        sys.stdout.write(f"  Testing {name:<20} ... ")
        sys.stdout.flush()
        t0 = time.time()
        try:
            if hasattr(adapter, "test_connection"):
                probe = adapter.test_connection()
            else:
                meta = adapter.get_metadata()
                probe = {"status": "available", "provider": name, "endpoint": "Local Archive / WCS"}
            latency = probe.get("latency_ms", round((time.time() - t0) * 1000, 1))
            status = probe.get("status", "unknown")
            endpoint = probe.get("endpoint", "N/A")
            err = probe.get("error")
            print(f"[{status.upper()}] ({latency} ms)")
            results.append({"name": name, "status": status, "latency_ms": latency, "endpoint": endpoint, "error": err})
        except Exception as e:
            print(f"[ERROR] ({str(e)})")
            results.append({"name": name, "status": "error", "latency_ms": None, "endpoint": "N/A", "error": str(e)})
    print("\n" + "=" * 80)
    print(" Diagnostic Summary Table")
    print("=" * 80)
    print(f"{"Provider":<20} | {"Status":<12} | {"Latency":<10} | {"Endpoint"}")
    print("-" * 80)
    for r in results:
        lat_str = f"{r['latency_ms']} ms" if r["latency_ms"] is not None else "N/A"
        print(f"{r['name']:<20} | {r['status'].upper():<12} | {lat_str:<10} | {r['endpoint'][:35]}")
    print("\nTesting Combined Regional Pipeline (Bay of Bengal sample)...")
    try:
        combined = COLLECTOR.get_combined_region(provider="auto", variable="temperature", min_lat=17.0, max_lat=20.0, min_lon=85.0, max_lon=88.0, resolution="low")
        print("  ✓ Combined Region Success!")
        print(f"    Active Ocean Provider: {combined['metadata']['active_provider']}")
        print(f"    Active Bathymetry:     {combined['metadata']['active_bathymetry']}")
        if combined["ocean"]:
            print(f"    Ocean Grid Shape:      {len(combined['ocean']['latitude'])}x{len(combined['ocean']['longitude'])}")
        if combined["bathymetry"]:
            print(f"    Seabed Grid Shape:     {len(combined['bathymetry']['latitude'])}x{len(combined['bathymetry']['longitude'])}")
            print(f"    Max Seabed Depth:      {combined['bathymetry']['maxDepthKm']} km")
    except Exception as e:
        print(f"  ✗ Combined Region Error: {e}")
    print("\nDiagnostic complete.\n")

if __name__ == "__main__":
    test_all_providers()
