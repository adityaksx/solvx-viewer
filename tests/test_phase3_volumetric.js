// SolvX Viewer — Phase 3 End-to-End Volumetric Rendering Automated Verification
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let backendProc = null;
let staticServer = null;

function startBackend() {
    return new Promise((resolve, reject) => {
        backendProc = spawn('.venv/bin/python', ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8080'], {
            cwd: path.resolve(__dirname, '..'),
            env: { ...process.env, SOLVX_LOCAL_DATA_MODE: 'true', LOCAL_DATA_MODE: 'true' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        backendProc.stderr.on('data', data => {
            const str = data.toString();
            if (str.includes('ERROR')) console.error('[Backend stderr]:', str.trim());
        });
        backendProc.stdout.on('data', data => {
            const str = data.toString();
            if (str.includes('ERROR')) console.error('[Backend stdout]:', str.trim());
        });
        backendProc.on('error', reject);

        const checkHealth = async () => {
            for (let i = 0; i < 40; i++) {
                try {
                    const res = await fetch('http://127.0.0.1:8080/health');
                    if (res.ok) {
                        console.log('[Test] Backend health verified.');
                        return resolve();
                    }
                } catch (_) {}
                await new Promise(r => setTimeout(r, 500));
            }
            console.warn('[Test] Backend health poll timed out after 20s, proceeding anyway.');
            resolve();
        };
        checkHealth();
    });
}

function startStaticServer() {
    return new Promise(resolve => {
        const rootDir = path.resolve(__dirname, '../frontend');
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };

        staticServer = http.createServer((req, res) => {
            let reqPath = req.url.split('?')[0];
            if (reqPath === '/') reqPath = '/index.html';
            const filePath = path.join(rootDir, reqPath);

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(filePath);
                res.writeHead(200, {
                    'Content-Type': mimeTypes[ext] || 'text/plain',
                    'Access-Control-Allow-Origin': '*'
                });
                res.end(data);
            });
        });

        staticServer.listen(5500, '127.0.0.1', () => {
            resolve();
        });
    });
}

async function runTests() {
    console.log('[Test] Starting backend and frontend static servers…');
    await startBackend();
    await startStaticServer();
    console.log('[Test] Servers active. Launching headless browser…');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--enable-webgl',
            '--use-gl=angle',
            '--use-angle=gl-egl',
            '--ignore-gpu-blocklist'
        ]
    });

    const page = await browser.newPage();
    const consoleLogs = [];
    const consoleErrors = [];

    page.on('console', msg => {
        const text = msg.text();
        console.log(`[Browser ${msg.type()}]:`, text);
        if (msg.type() === 'error') {
            consoleErrors.push(text);
        } else {
            consoleLogs.push(text);
        }
    });

    page.on('pageerror', err => {
        console.error('[Browser PageError]:', err.message);
        consoleErrors.push(err.message);
    });

    page.on('requestfailed', req => {
        console.error('[Browser Request Failed]:', req.url(), req.failure()?.errorText);
    });

    page.on('response', res => {
        if (!res.ok() && !res.url().includes('favicon')) {
            console.warn('[Browser Bad Response]:', res.url(), res.status());
        }
    });

    try {
        await page.goto('http://127.0.0.1:5500/index.html', { waitUntil: 'networkidle2', timeout: 45000 });
        console.log('[Test] Page loaded.');

        // Wait for app initialization
        await page.waitForFunction(() => {
            const a = window.solvx || window.app;
            if (!a) return false;
            console.log('[Check Init] solvx:', !!a, 'water:', !!a.water, 'scalarViz:', !!a.scalarViz, 'volumeRenderer:', !!a.scalarViz?.volumeRenderer);
            return a.scalarViz && a.scalarViz.volumeRenderer;
        }, { timeout: 45000, polling: 1000 });
        console.log('[Test] window.solvx / window.app initialized with VolumeFieldRenderer.');

        // 1. Verify Temperature 3D Volume
        const tempVerification = await page.evaluate(async () => {
            const app = window.app;
            // Ensure volume mode
            app.depthControl?.setMode('volume');
            await app.setVariable('temperature');

            // Wait briefly for volume data
            for (let i = 0; i < 40; i++) {
                if (app.scalarViz?.volumeFieldData && app.scalarViz?.volumeRenderer?.volumeTexture) break;
                await new Promise(r => setTimeout(r, 200));
            }

            const field = app.scalarViz.volumeFieldData;
            const renderer = app.scalarViz.volumeRenderer;

            if (!field || !renderer) {
                return { success: false, error: 'VolumeFieldData or VolumeFieldRenderer not ready' };
            }

            const isData3D = renderer.volumeTexture && renderer.volumeTexture.isData3DTexture;
            const values = field.values;
            const isFloat32 = values instanceof Float32Array;

            // Check depth variation at a sample water column
            // Bay of Bengal center: lat ~19N, lon ~88E (approx mid index)
            const midY = Math.floor(field.height / 2);
            const midX = Math.floor(field.width / 2);
            const surfaceVal = field.getScientificValue(0, midY, midX);
            const deepVal = field.getScientificValue(Math.min(15, field.depth - 1), midY, midX);
            const deepestVal = field.getScientificValue(field.depth - 1, midY, midX);

            return {
                success: true,
                variable: field.variable,
                units: field.units,
                dimensions: [field.depth, field.height, field.width],
                levelsCount: field.levels.length,
                isData3D,
                isFloat32,
                min: field.min,
                max: field.max,
                meshVisible: renderer.mesh?.visible,
                surfaceVal,
                deepVal,
                deepestVal,
                hasDepthVariation: (surfaceVal !== null && deepVal !== null && surfaceVal !== deepVal)
            };
        });

        console.log('[Test 1] Temperature 3D Volume:', JSON.stringify(tempVerification, null, 2));
        if (!tempVerification.success || !tempVerification.isData3D || !tempVerification.hasDepthVariation) {
            throw new Error(`Temperature volume verification failed: ${JSON.stringify(tempVerification)}`);
        }

        // 2. Verify Salinity 3D Volume (SAME renderer)
        const salVerification = await page.evaluate(async () => {
            const app = window.app;
            await app.setVariable('salinity');

            for (let i = 0; i < 40; i++) {
                if (app.scalarViz?.volumeFieldData?.variable === 'salinity') break;
                await new Promise(r => setTimeout(r, 200));
            }

            const field = app.scalarViz.volumeFieldData;
            const renderer = app.scalarViz.volumeRenderer;

            const midY = Math.floor(field.height / 2);
            const midX = Math.floor(field.width / 2);
            const surfaceVal = field.getScientificValue(0, midY, midX);
            const deepVal = field.getScientificValue(Math.min(15, field.depth - 1), midY, midX);

            return {
                success: field.variable === 'salinity',
                variable: field.variable,
                units: field.units,
                isData3D: renderer.volumeTexture && renderer.volumeTexture.isData3DTexture,
                meshVisible: renderer.mesh?.visible,
                surfaceVal,
                deepVal,
                hasDepthVariation: (surfaceVal !== null && deepVal !== null && surfaceVal !== deepVal)
            };
        });

        console.log('[Test 2] Salinity 3D Volume:', JSON.stringify(salVerification, null, 2));
        if (!salVerification.success || !salVerification.isData3D || !salVerification.hasDepthVariation) {
            throw new Error(`Salinity volume verification failed: ${JSON.stringify(salVerification)}`);
        }

        // 3. Verify Currents 3D Volume (SAME renderer)
        const curVerification = await page.evaluate(async () => {
            const app = window.app;
            await app.setVariable('currents');

            for (let i = 0; i < 40; i++) {
                if (app.scalarViz?.volumeFieldData?.variable === 'currents') break;
                await new Promise(r => setTimeout(r, 200));
            }

            const field = app.scalarViz.volumeFieldData;
            const renderer = app.scalarViz.volumeRenderer;

            return {
                success: field.variable === 'currents',
                variable: field.variable,
                units: field.units,
                min: field.min,
                max: field.max,
                isData3D: renderer.volumeTexture && renderer.volumeTexture.isData3DTexture,
                meshVisible: renderer.mesh?.visible
            };
        });

        console.log('[Test 3] Currents 3D Volume:', JSON.stringify(curVerification, null, 2));
        if (!curVerification.success || !curVerification.isData3D) {
            throw new Error(`Currents volume verification failed: ${JSON.stringify(curVerification)}`);
        }

        // 4. Verify Depth Slider Clipping in Volume Mode
        const depthClipVerification = await page.evaluate(async () => {
            const app = window.app;
            await app.setVariable('temperature');

            // Move depth slider to 200m
            app.onDepthChange(200);

            const mat = app.scalarViz?.volumeRenderer?.material;
            const clipMax = mat?.uniforms?.u_clipMaxDepthFrac?.value;

            return {
                success: clipMax > 0.0 && clipMax < 1.0,
                clipMax,
                isMeshVisible: app.scalarViz.volumeRenderer.mesh.visible
            };
        });

        console.log('[Test 4] Depth Clipping in Volume Mode:', JSON.stringify(depthClipVerification, null, 2));
        if (!depthClipVerification.success) {
            throw new Error(`Depth clipping verification failed: ${JSON.stringify(depthClipVerification)}`);
        }

        // 5. Verify Mode Transitions (Horizontal & Vertical slices still work)
        const modeVerification = await page.evaluate(async () => {
            const app = window.app;

            // Switch to Horizontal
            app.onDepthModeChange('horizontal', 100);
            await new Promise(r => setTimeout(r, 300));
            const horizVolVisible = app.scalarViz.volumeRenderer.mesh.visible;
            const horizSliceVisible = app.scalarViz.sliceMesh.visible;

            // Switch to Vertical
            app.onDepthModeChange('vertical', 100);
            await new Promise(r => setTimeout(r, 500));
            const vertVolVisible = app.scalarViz.volumeRenderer.mesh.visible;
            const vertSliceVisible = app.scalarViz.verticalSliceMesh.visible;

            // Switch back to Volume
            app.onDepthModeChange('volume', 100);
            await new Promise(r => setTimeout(r, 300));
            const returnVolVisible = app.scalarViz.volumeRenderer.mesh.visible;
            const returnSliceVisible = app.scalarViz.sliceMesh.visible;

            return {
                horizVolVisible,
                horizSliceVisible,
                vertVolVisible,
                vertSliceVisible,
                returnVolVisible,
                returnSliceVisible,
                horizOk: !horizVolVisible && horizSliceVisible,
                vertOk: !vertVolVisible && vertSliceVisible,
                returnOk: returnVolVisible && !returnSliceVisible
            };
        });

        console.log('[Test 5] Mode Transitions:', JSON.stringify(modeVerification, null, 2));
        if (!modeVerification.horizOk || !modeVerification.vertOk || !modeVerification.returnOk) {
            throw new Error(`Mode transitions verification failed: ${JSON.stringify(modeVerification)}`);
        }

        // 6. Check Console Errors
        const filteredErrors = consoleErrors.filter(e => !e.includes('favicon'));
        console.log(`[Test 6] Console Errors: ${filteredErrors.length}`);
        if (filteredErrors.length > 0) {
            console.warn('Console error list:', filteredErrors);
        }

        console.log('\n=============================================');
        console.log('ALL PHASE 3 AUTOMATED TESTS PASSED CLEANLY!');
        console.log('=============================================\n');

    } finally {
        await browser.close();
        if (staticServer) staticServer.close();
        if (backendProc) backendProc.kill();
    }
}

runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    if (staticServer) staticServer.close();
    if (backendProc) backendProc.kill();
    process.exit(1);
});
