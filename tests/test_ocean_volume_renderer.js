// Unit & Integration Tests for OceanVolumeRenderer and 3D Field Helpers
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import {
    flatten3DField,
    depthToIndices,
    normalizeScalar
} from '../frontend/scene/oceanVolumeRenderer.js';

console.log('--- Starting OceanVolumeRenderer Tests ---');

// 1. Test normalizeScalar
console.log('[1/4] Testing normalizeScalar()...');
assert.strictEqual(normalizeScalar(25.0, 20.0, 30.0), 0.5);
assert.strictEqual(normalizeScalar(20.0, 20.0, 30.0), 0.0);
assert.strictEqual(normalizeScalar(30.0, 20.0, 30.0), 1.0);
assert.strictEqual(normalizeScalar(10.0, 20.0, 30.0), 0.0); // clamped lower
assert.strictEqual(normalizeScalar(40.0, 20.0, 30.0), 1.0); // clamped upper
assert.strictEqual(normalizeScalar(NaN, 20.0, 30.0), 0.0);
assert.strictEqual(normalizeScalar(null, 20.0, 30.0), 0.0);
console.log('✓ normalizeScalar passed.');

// 2. Test depthToIndices with non-uniform levels
console.log('[2/4] Testing depthToIndices()...');
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
console.log('[3/4] Testing flatten3DField()...');
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

// 4. Test with full real NetCDF data from Python bridge
console.log('[4/4] Testing with real model vertical profile...');
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

console.log('\nAll OceanVolumeRenderer tests PASSED successfully!\n');
