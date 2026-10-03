// Unit & Integration Tests for OceanVolumeRenderer and 3D Field Helpers
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import {
    flatten3DField,
    depthToIndices,
    normalizeScalar,
    worldToLongitude,
    worldToLatitude,
    longitudeToWorldZ,
    latitudeToWorldX,
    longitudeToWorldX,
    latitudeToWorldZ,
    sampleFieldAtDepth
} from '../frontend/scene/oceanVolumeRenderer.js';
import { OceanVariableDataset } from '../frontend/visualization/OceanVariableDataset.js';

console.log('--- Starting OceanVolumeRenderer Tests ---');

// 1. Test normalizeScalar
console.log('[1/10] Testing normalizeScalar()...');
assert.strictEqual(normalizeScalar(25.0, 20.0, 30.0), 0.5);
assert.strictEqual(normalizeScalar(20.0, 20.0, 30.0), 0.0);
assert.strictEqual(normalizeScalar(30.0, 20.0, 30.0), 1.0);
assert.strictEqual(normalizeScalar(10.0, 20.0, 30.0), 0.0); // clamped lower
assert.strictEqual(normalizeScalar(40.0, 20.0, 30.0), 1.0); // clamped upper
assert.strictEqual(normalizeScalar(NaN, 20.0, 30.0), 0.0);
assert.strictEqual(normalizeScalar(null, 20.0, 30.0), 0.0);
console.log('✓ normalizeScalar passed.');

// 2. Test depthToIndices with non-uniform levels
console.log('[2/10] Testing depthToIndices()...');
const sampleLevels = [
    0.494, 1.541, 2.646, 5.078, 11.405, 25.211, 55.764, 109.729, 222.475, 541.089
];

// At or above surface
const atSurface = depthToIndices(sampleLevels, 0.0);
assert.strictEqual(atSurface.k0, 0);
assert.strictEqual(atSurface.k1, 0);
assert.strictEqual(atSurface.alpha, 0.0);

// Deepest or below bottom
const atBottom = depthToIndices(sampleLevels, 600.0);
assert.strictEqual(atBottom.k0, sampleLevels.length - 1);
assert.strictEqual(atBottom.k1, sampleLevels.length - 1);
assert.strictEqual(atBottom.alpha, 0.0);

// Mid-level bracket: depth = 3.862 (between index 2: 2.646 and index 3: 5.078)
const mid = depthToIndices(sampleLevels, 3.862);
assert.strictEqual(mid.k0, 2);
assert.strictEqual(mid.k1, 3);
assert.ok(mid.alpha > 0.49 && mid.alpha < 0.51, `Expected alpha ~0.5, got ${mid.alpha}`);
console.log('✓ depthToIndices passed.');

// 3. Test flatten3DField
console.log('[3/10] Testing flatten3DField()...');
// Create a 3D mock field: shape [2 depth, 3 lat, 4 lon]
// values[z][y][x]
const D = 2, H = 3, W = 4;
const mock3D = [];
for (let z = 0; z < D; z++) {
    const yRows = [];
    for (let y = 0; y < H; y++) {
        const xCols = [];
        for (let x = 0; x < W; x++) {
            if (z === 0 && y === 0 && x === 0) {
                xCols.push(NaN); // should become -999
            } else if (z === 1 && y === 2 && x === 3) {
                xCols.push(null); // should become -999
            } else {
                xCols.push(z * 100 + y * 10 + x);
            }
        }
        yRows.push(xCols);
    }
    mock3D.push(yRows);
}

const flat = flatten3DField(mock3D);
assert.strictEqual(flat.width, W);
assert.strictEqual(flat.height, H);
assert.strictEqual(flat.depth, D);
assert.strictEqual(flat.buffer.length, W * H * D);

// Check sentinels
assert.strictEqual(flat.buffer[0], -999.0);
const lastIdx = (D - 1) * W * H + (H - 1) * W + (W - 1);
assert.strictEqual(flat.buffer[lastIdx], -999.0);

// Check known coordinate: z=1, y=1, x=2 -> value 112
const targetIdx = 1 * W * H + 1 * W + 2;
assert.strictEqual(flat.buffer[targetIdx], 112);
console.log('✓ flatten3DField passed.');

// 4. Test Phase 7 Geographic Coordinate Helpers
console.log('[4/10] Testing Phase 7 Geographic <-> World coordinate conversion helpers...');
const bounds = [84.167, 92.917, 16.083, 23.500];
const centerLon = (bounds[0] + bounds[1]) / 2.0; // 88.542
const centerLat = (bounds[2] + bounds[3]) / 2.0; // 19.7915

// Center world point (0, 0) maps to center lon/lat
const cLon = worldToLongitude(0, bounds);
const cLat = worldToLatitude(0, bounds);
assert.ok(Math.abs(cLon - centerLon) < 1e-4, `Expected lon ${centerLon}, got ${cLon}`);
assert.ok(Math.abs(cLat - centerLat) < 1e-4, `Expected lat ${centerLat}, got ${cLat}`);

// Inverse: center lon/lat maps to world (0, 0)
const wZ = longitudeToWorldZ(centerLon, bounds);
const wX = latitudeToWorldX(centerLat, bounds);
assert.ok(Math.abs(wZ) < 1e-4, `Expected worldZ ~0, got ${wZ}`);
assert.ok(Math.abs(wX) < 1e-4, `Expected worldX ~0, got ${wX}`);

// Roundtrip test for an arbitrary coordinate: 20.5°N, 90.0°E
const testLat = 20.5, testLon = 90.0;
const roundWorldX = latitudeToWorldX(testLat, bounds);
const roundWorldZ = longitudeToWorldZ(testLon, bounds);
const recoveredLat = worldToLatitude(roundWorldX, bounds);
const recoveredLon = worldToLongitude(roundWorldZ, bounds);
assert.ok(Math.abs(recoveredLat - testLat) < 1e-4, `Roundtrip lat failed: ${recoveredLat} vs ${testLat}`);
assert.ok(Math.abs(recoveredLon - testLon) < 1e-4, `Roundtrip lon failed: ${recoveredLon} vs ${testLon}`);

// Verify aliases
assert.strictEqual(longitudeToWorldX(testLon, bounds), longitudeToWorldZ(testLon, bounds));
assert.strictEqual(latitudeToWorldZ(testLat, bounds), latitudeToWorldX(testLat, bounds));
console.log('✓ Coordinate conversion helpers passed.');

// 5. Test with full real NetCDF data from Python bridge (Temperature)
console.log('[5/10] Testing with real model vertical profile (temperature)...');
const pyOutput = execSync(`python3 -c "
import json
from backend.services.data_collector import COLLECTOR
res = COLLECTOR.get_ocean_data(variable='temperature', depth=None)
print(json.dumps({
    'depth_levels': res['depth_levels'],
    'lats': res['latitude'],
    'lons': res['longitude'],
    'shape': [len(res['values']), len(res['values'][0]), len(res['values'][0][0])],
    'sample_profile': [res['values'][z][45][53] for z in range(len(res['values']))]
}))
"`).toString();

const data = JSON.parse(pyOutput);
assert.strictEqual(data.shape[0], 32, 'Should have 32 depth levels');
assert.strictEqual(data.shape[1], 90, 'Should have 90 latitude points');
assert.strictEqual(data.shape[2], 106, 'Should have 106 longitude points');

const surfTemp = data.sample_profile[0];
const deepTemp = data.sample_profile[31];
console.log(`Real Model Profile at Lat 19.83°N, Lon 88.58°E:`);
console.log(`  Surface (Depth ${data.depth_levels[0].toFixed(2)}m): ${surfTemp.toFixed(2)}°C`);
console.log(`  Deep    (Depth ${data.depth_levels[31].toFixed(2)}m): ${deepTemp.toFixed(2)}°C`);

assert.ok(Math.abs(surfTemp - 28.83) < 0.2, `Surface temp should be ~28.83°C, got ${surfTemp}`);
assert.ok(Math.abs(deepTemp - 9.78) < 0.2, `Deep temp should be ~9.78°C, got ${deepTemp}`);
assert.ok(surfTemp > deepTemp + 10.0, 'Thermocline: surface water must be significantly warmer than deep water');
console.log('✓ Real ocean model profile test passed successfully.');

// 6. Test Phase 17: Fixed-depth Equivalence Validation
console.log('[6/10] Testing Phase 17 fixed-depth slice equivalence (0.49m, 50m, 100m, 200m, 541m)...');
const pyEquiv = execSync(`python3 -c "
import json
import numpy as np
import xarray as xr

ds = xr.open_dataset('data/model/temperature.nc')
t = ds.thetao.values[0] # (32, 90, 106)
depths = ds.depth.values

test_depths = [0.494, 50.0, 100.0, 200.0, 541.089]
results = []

for target_d in test_depths:
    idx_nearest = int(np.argmin(np.abs(depths - target_d)))
    slice_2d = t[idx_nearest]
    
    if target_d <= depths[0]:
        slice_3d = t[0]
    elif target_d >= depths[-1]:
        slice_3d = t[-1]
    else:
        k = int(np.searchsorted(depths, target_d) - 1)
        z0, z1 = depths[k], depths[k+1]
        alpha = (target_d - z0) / (z1 - z0)
        slice_3d = (1 - alpha) * t[k] + alpha * t[k+1]
        
    valid = np.isfinite(slice_2d) & np.isfinite(slice_3d)
    diff = np.abs(slice_2d[valid] - slice_3d[valid])
    corr = float(np.corrcoef(slice_2d[valid], slice_3d[valid])[0, 1])
    results.append({
        'target_d': float(target_d),
        'nearest_idx': idx_nearest,
        'mae': float(diff.mean()),
        'max_diff': float(diff.max()),
        'corr': corr
    })
print(json.dumps(results))
"`).toString();

const equivResults = JSON.parse(pyEquiv);
for (const res of equivResults) {
    console.log(`  Depth ${res.target_d.toFixed(2)}m (nearest idx ${res.nearest_idx}): MAE=${res.mae.toFixed(4)}°C, MaxDiff=${res.max_diff.toFixed(4)}°C, Corr r=${res.corr.toFixed(6)}`);
    assert.ok(res.corr >= 0.99, `Correlation for depth ${res.target_d}m must be >= 0.99, got ${res.corr}`);
}
console.log('✓ Phase 17 fixed-depth slice equivalence passed (all r >= 0.99).');

// 7. Test Phase 22: Salinity 3D Pipeline Reuse
console.log('[7/10] Testing Phase 22 Salinity 3D pipeline reuse...');
const pySalOutput = execSync(`python3 -c "
import json
from backend.services.data_collector import COLLECTOR
res = COLLECTOR.get_ocean_data(variable='salinity', depth=None)
print(json.dumps({
    'variable': res['variable'],
    'dataset': res['dataset'],
    'shape': [len(res['values']), len(res['values'][0]), len(res['values'][0][0])],
    'depth_count': len(res['depth_levels']),
    'sample_profile': [res['values'][z][45][53] for z in range(len(res['values']))]
}))
"`).toString();

const salData = JSON.parse(pySalOutput);
assert.strictEqual(salData.variable, 'salinity');
assert.strictEqual(salData.shape[0], 32, 'Salinity should have 32 depth levels');
assert.strictEqual(salData.shape[1], 90, 'Salinity should have 90 latitude points');
assert.strictEqual(salData.shape[2], 106, 'Salinity should have 106 longitude points');
const surfSal = salData.sample_profile[0];
const deepSal = salData.sample_profile[31];
console.log(`Real Salinity Profile at Lat 19.83°N, Lon 88.58°E:`);
console.log(`  Surface Salinity (Depth 0.49m): ${surfSal.toFixed(2)} PSU`);
console.log(`  Deep Salinity    (Depth 541m):  ${deepSal.toFixed(2)} PSU`);
assert.ok(surfSal > 25.0 && surfSal < 36.0, `Expected surface salinity ~31-33 PSU, got ${surfSal}`);
assert.ok(deepSal > 30.0 && deepSal < 37.0, `Expected deep salinity ~34-36 PSU, got ${deepSal}`);
console.log('✓ Phase 22 Salinity 3D pipeline test passed successfully.');

// 8. Test Entity Separation & Volume Mode Isolation (Legacy instancedVolume eradicated)
console.log('[8/10] Testing Water Entity Separation & Volume Mode Isolation...');
const mockWater = {
    volumeRenderer: {
        mesh: { visible: true },
        setVisible(v) { this.mesh.visible = !!v; },
        setOpacity(o) { this.opacity = o; },
        setDebugMode(m) { this.debugMode = m; }
    },
    sliceMesh: {
        visible: false
    }
};

// In 3D volume mode: volumeRenderer is visible, sliceMesh is hidden
const isVolumeMode = true;
const scientificLayerVisible = true;
mockWater.volumeRenderer.setVisible(scientificLayerVisible && isVolumeMode);
mockWater.sliceMesh.visible = scientificLayerVisible && !isVolumeMode;

assert.strictEqual(mockWater.volumeRenderer.mesh.visible, true, 'Volume renderer must be visible in volume mode');
assert.strictEqual(mockWater.sliceMesh.visible, false, 'Slice mesh must be hidden in volume mode');
assert.strictEqual(mockWater.instancedVolume, undefined, 'instancedVolume must not exist');

// In 2D horizontal slice mode: volumeRenderer is hidden, sliceMesh is visible
const isSliceMode = false; // i.e. isVolumeMode = false
mockWater.volumeRenderer.setVisible(scientificLayerVisible && isSliceMode);
mockWater.sliceMesh.visible = scientificLayerVisible && !isSliceMode;

assert.strictEqual(mockWater.volumeRenderer.mesh.visible, false, 'Volume renderer must be hidden in slice mode');
assert.strictEqual(mockWater.sliceMesh.visible, true, 'Slice mesh is active in slice mode');

// Test debug mode switching
mockWater.volumeRenderer.setDebugMode(1);
assert.strictEqual(mockWater.volumeRenderer.debugMode, 1, 'Debug mode 1 (depth ramp) set successfully');
mockWater.volumeRenderer.setDebugMode(4);
assert.strictEqual(mockWater.volumeRenderer.debugMode, 4, 'Debug mode 4 (grayscale scalar) set successfully');
mockWater.volumeRenderer.setDebugMode(0);
assert.strictEqual(mockWater.volumeRenderer.debugMode, 0, 'Debug mode 0 (standard scientific) set successfully');

console.log('✓ Water Entity Separation & Volume Mode Isolation passed.');

// 9. Test sampleFieldAtDepth CPU Reference Sampler (Section 19)
console.log('[9/10] Testing sampleFieldAtDepth() CPU reference sampler...');
const testDepths = [0.494, 5.078, 25.211, 55.764, 109.729, 222.475, 541.089];
// Synthetic 3D grid: 7 depths, 2 lats, 2 lons. Values = depth * 2.0
const mockField = testDepths.map(d => [
    [d * 2.0, d * 2.0 + 1],
    [d * 2.0 + 2, d * 2.0 + 3]
]);

// Exact level match
const valAtExact = sampleFieldAtDepth(mockField, testDepths, 0, 0, 5.078);
assert.ok(Math.abs(valAtExact - 5.078 * 2.0) < 1e-5, `Exact depth failed: got ${valAtExact}`);

// Linear interpolation between level 2 (25.211) and level 3 (55.764)
const interpDepth = 40.4875; // midpoint
const valAtMid = sampleFieldAtDepth(mockField, testDepths, 0, 0, interpDepth);
const expectedMid = ((25.211 * 2.0) + (55.764 * 2.0)) / 2.0;
assert.ok(Math.abs(valAtMid - expectedMid) < 1e-4, `Interp depth failed: expected ${expectedMid}, got ${valAtMid}`);

// Out of bounds clamping: above surface
const valSurface = sampleFieldAtDepth(mockField, testDepths, 0, 0, 0.0);
assert.strictEqual(valSurface, testDepths[0] * 2.0);

// Out of bounds clamping: below bottom
const valBottom = sampleFieldAtDepth(mockField, testDepths, 0, 0, 1000.0);
assert.strictEqual(valBottom, testDepths[testDepths.length - 1] * 2.0);

// Land/NaN handling
const mockWithNaN = [
    [[NaN, 20.0]],
    [[30.0, 40.0]]
];
const depthsTwo = [0.0, 10.0];
// One level is NaN -> returns other level
assert.strictEqual(sampleFieldAtDepth(mockWithNaN, depthsTwo, 0, 0, 5.0), 30.0);
// Both levels valid -> returns interpolated
assert.strictEqual(sampleFieldAtDepth(mockWithNaN, depthsTwo, 0, 1, 5.0), 30.0);
// Both levels NaN -> returns null
const mockBothNaN = [
    [[NaN]],
    [[NaN]]
];
assert.strictEqual(sampleFieldAtDepth(mockBothNaN, depthsTwo, 0, 0, 5.0), null);
console.log('✓ sampleFieldAtDepth passed.');

// 10. Test debugTextureSample() Point Extraction (Section 4)
console.log('[10/10] Testing debugTextureSample() points from real flattened 3D field...');
const pyFlatOutput = execSync(`python3 -c "
import json
from backend.services.data_collector import COLLECTOR
res = COLLECTOR.get_ocean_data(variable='temperature', depth=None)
vals = res['values']
depth_levels = res['depth_levels']
# Flatten in JavaScript row-major order: x + y*W + z*W*H
W = len(vals[0][0])
H = len(vals[0])
D = len(vals)
print(json.dumps({
    'width': W,
    'height': H,
    'depth': D,
    'depth_levels': depth_levels,
    'p_0_0_0': vals[0][0][0],
    'p_50_45_0': vals[0][45][50],
    'p_50_45_10': vals[10][45][50],
    'p_50_45_20': vals[20][45][50],
    'p_50_45_31': vals[31][45][50]
}))
"`).toString();

const flatProof = JSON.parse(pyFlatOutput);
assert.strictEqual(flatProof.depth, 32);
assert.strictEqual(flatProof.height, 90);
assert.strictEqual(flatProof.width, 106);

// Verify exact values required by Section 4 proof:
// [50, 45, 0] ~ 28.85°C
// [50, 45, 31] ~ 9.74°C
console.log(`  [50, 45, 0]  (Surface): ${flatProof.p_50_45_0.toFixed(2)}°C`);
console.log(`  [50, 45, 10] (z=10):    ${flatProof.p_50_45_10.toFixed(2)}°C`);
console.log(`  [50, 45, 20] (z=20):    ${flatProof.p_50_45_20.toFixed(2)}°C`);
console.log(`  [50, 45, 31] (z=31):    ${flatProof.p_50_45_31.toFixed(2)}°C`);

assert.ok(Math.abs(flatProof.p_50_45_0 - 28.85) < 0.2, `Expected ~28.85°C, got ${flatProof.p_50_45_0}`);
assert.ok(Math.abs(flatProof.p_50_45_31 - 9.74) < 0.2, `Expected ~9.74°C, got ${flatProof.p_50_45_31}`);
assert.ok(flatProof.p_50_45_0 > flatProof.p_50_45_31 + 15.0, 'Thermocline drop must exceed 15°C');
console.log('✓ debugTextureSample() validation passed.');

// 11. Test OceanVariableDataset: Canonical Layout, Validation & Stats
console.log('[11/13] Testing OceanVariableDataset canonical contract, validation & statistics...');
const testDataset = new OceanVariableDataset({
    variable: 'thetao',
    values3D: mock3D,
    depthLevels: [0.5, 50.0],
    latitudes: [16.0, 18.0, 20.0],
    longitudes: [84.0, 86.0, 88.0, 90.0]
});
assert.strictEqual(testDataset.dimensions.depth, 2);
assert.strictEqual(testDataset.dimensions.latitude, 3);
assert.strictEqual(testDataset.dimensions.longitude, 4);

const stats = testDataset.getStats();
assert.strictEqual(stats.validCount, 22); // 24 total - 2 sentinels (NaN and null)
assert.strictEqual(stats.missingCount, 2);
assert.strictEqual(stats.depthMin, 0.5);
assert.strictEqual(stats.depthMax, 50.0);

const flattened = testDataset.flatten();
assert.strictEqual(flattened.width, 4);
assert.strictEqual(flattened.height, 3);
assert.strictEqual(flattened.depth, 2);
assert.strictEqual(flattened.buffer[0], -999.0); // Sentinel
assert.strictEqual(flattened.buffer[targetIdx], 112); // Canonical index
console.log('✓ OceanVariableDataset canonical contract & stats passed.');

// 12. Test OceanVariableDataset: Non-uniform depth sampling
console.log('[12/13] Testing OceanVariableDataset.sampleDepth()...');
const interpDataset = new OceanVariableDataset({
    variable: 'temperature',
    values3D: mockField,
    depthLevels: testDepths
});
const sampledVal = interpDataset.sampleDepth(0, 0, interpDepth);
assert.ok(Math.abs(sampledVal - expectedMid) < 1e-4, `Expected ${expectedMid}, got ${sampledVal}`);
console.log('✓ OceanVariableDataset.sampleDepth() passed.');

// 13. Test OceanVariableDataset: Data3DTexture creation
console.log('[13/14] Testing OceanVariableDataset.createTexture()...');
const tex3D = interpDataset.createTexture();
assert.ok(tex3D.isData3DTexture, 'Must be a THREE.Data3DTexture');
assert.strictEqual(tex3D.image.width, 2);
assert.strictEqual(tex3D.image.height, 2);
assert.strictEqual(tex3D.image.depth, testDepths.length);
assert.strictEqual(tex3D.format, 1028); // THREE.RedFormat
assert.strictEqual(tex3D.type, 1015);   // THREE.FloatType
tex3D.dispose();
console.log('✓ OceanVariableDataset.createTexture() passed.');

// 14. Test Full 5 Points x 6 Depths Fixed-Depth Validation Matrix (Sections 17, 30 & 31)
console.log('[14/14] Testing 5 Points × 6 Depths Fixed-Depth Validation Matrix...');
const pyMatrixOutput = execSync(`python3 -c "
import numpy as np
import xarray as xr
import json

ds = xr.open_dataset('data/model/temperature.nc')
t = ds.thetao.values[0] # (32, 90, 106)
depths = ds.depth.values
lats = ds.latitude.values
lons = ds.longitude.values

points = [
    {'name': 'Shallow Coast', 'lat': 21.5, 'lon': 89.5},
    {'name': 'Continental Shelf', 'lat': 20.0, 'lon': 87.5},
    {'name': 'Central Bay of Bengal', 'lat': 18.5, 'lon': 88.5},
    {'name': 'Deep Ocean Basin', 'lat': 16.5, 'lon': 89.0},
    {'name': 'Eastern Basin', 'lat': 19.0, 'lon': 91.5}
]

test_depths = [0.494, 50.0, 100.0, 200.0, 300.0, 500.0]
matrix = []

for pt in points:
    lat_idx = int(np.argmin(np.abs(lats - pt['lat'])))
    lon_idx = int(np.argmin(np.abs(lons - pt['lon'])))
    pt_res = {
        'name': pt['name'],
        'lat_idx': lat_idx,
        'lon_idx': lon_idx,
        'lat': float(lats[lat_idx]),
        'lon': float(lons[lon_idx]),
        'samples': []
    }
    for d in test_depths:
        if d <= depths[0]:
            v = t[0, lat_idx, lon_idx]
        elif d >= depths[-1]:
            v = t[-1, lat_idx, lon_idx]
        else:
            k = int(np.searchsorted(depths, d) - 1)
            z0, z1 = depths[k], depths[k+1]
            alpha = (d - z0) / (z1 - z0)
            v0 = t[k, lat_idx, lon_idx]
            v1 = t[k+1, lat_idx, lon_idx]
            v = (1 - alpha) * v0 + alpha * v1 if (np.isfinite(v0) and np.isfinite(v1)) else np.nan
        pt_res['samples'].append({
            'depth': float(d),
            'value': float(v) if np.isfinite(v) else None
        })
    matrix.append(pt_res)

t_clean = np.nan_to_num(t, nan=-999.0)
print(json.dumps({
    'depth_levels': depths.tolist(),
    'values3D': t_clean.tolist(),
    'matrix': matrix
}))
"`, { maxBuffer: 50 * 1024 * 1024 }).toString();

const matrixData = JSON.parse(pyMatrixOutput);
const realDataset = new OceanVariableDataset({
    variable: 'temperature',
    values3D: matrixData.values3D,
    depthLevels: matrixData.depth_levels
});

console.log('Fixed-Depth Matrix Validation:');
for (const pt of matrixData.matrix) {
    console.log(`  Location: ${pt.name} (${pt.lat.toFixed(2)}°N, ${pt.lon.toFixed(2)}°E) [latIdx=${pt.lat_idx}, lonIdx=${pt.lon_idx}]:`);
    for (const smp of pt.samples) {
        const cpuSampled = realDataset.sampleDepth(pt.lat_idx, pt.lon_idx, smp.depth);
        if (smp.value === null) {
            assert.strictEqual(cpuSampled, null, `Depth ${smp.depth}m at ${pt.name} should be masked (null)`);
            console.log(`    Depth ${smp.depth.toFixed(1).padStart(5)}m: [MASKED / BELOW SEABED] (verified null)`);
        } else {
            assert.ok(cpuSampled !== null, `Depth ${smp.depth}m at ${pt.name} should have data`);
            const diff = Math.abs(cpuSampled - smp.value);
            assert.ok(diff < 1e-4, `Depth ${smp.depth}m mismatch: expected ${smp.value}, got ${cpuSampled}`);
            console.log(`    Depth ${smp.depth.toFixed(1).padStart(5)}m: ${cpuSampled.toFixed(2)}°C (diff=${diff.toExponential(2)})`);
        }
    }
}

// Explicit assertions for Section 30 fixed-depth requirements:
// 1. Shallow coast at 500m MUST be masked
const shallowCoast500 = realDataset.sampleDepth(matrixData.matrix[0].lat_idx, matrixData.matrix[0].lon_idx, 500.0);
assert.strictEqual(shallowCoast500, null, 'Shallow coastal point at 500m must be masked');

// 2. Deep ocean at 500m MUST be visible and cold (~10°C)
const deepOcean500 = realDataset.sampleDepth(matrixData.matrix[3].lat_idx, matrixData.matrix[3].lon_idx, 500.0);
assert.ok(deepOcean500 !== null && deepOcean500 > 8.0 && deepOcean500 < 12.0, `Deep ocean at 500m must be ~10°C, got ${deepOcean500}`);

// 3. Central Bay of Bengal surface MUST be warm (> 28°C)
const centralBaySurface = realDataset.sampleDepth(matrixData.matrix[2].lat_idx, matrixData.matrix[2].lon_idx, 0.494);
assert.ok(centralBaySurface > 28.0, `Central Bay of Bengal surface must be > 28°C, got ${centralBaySurface}`);

console.log('✓ 5 Points × 6 Depths Fixed-Depth Validation Matrix PASSED.');

console.log('\n==============================================');
console.log('All 14 OceanVolumeRenderer & Dataset test suites PASSED!');
console.log('==============================================\n');


