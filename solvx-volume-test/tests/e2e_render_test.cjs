const puppeteer = require('puppeteer');

(async () => {
    console.log('Starting E2E render test with Puppeteer...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 850 });

    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.error('BROWSER ERROR:', msg.text());
            errors.push(msg.text());
        }
    });

    page.on('pageerror', err => {
        console.error('PAGE ERROR:', err.message);
        errors.push(err.message);
    });

    console.log('Navigating to http://localhost:8055...');
    await page.goto('http://localhost:8055', { waitUntil: 'networkidle2', timeout: 15000 });

    // 1. Wait 3 seconds for initial 70x synthetic volume to render
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_70x_3d.png' });
    console.log('Captured screenshot_70x_3d.png');

    // 2. Test Top-down view (verify zero dome / circular cutoff glitch)
    console.log('Testing Top-down view...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.setActiveViewBtn('btn-top');
            app.cameraManager.setView('top');
        }
    });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_top_view.png' });
    console.log('Captured screenshot_top_view.png');

    // 3. Test Side view (verify continuous water column to seabed)
    console.log('Testing Side view...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.setActiveViewBtn('btn-side');
            app.cameraManager.setView('side');
        }
    });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_side_view.png' });
    console.log('Captured screenshot_side_view.png');

    // Return to 3D view
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.setActiveViewBtn('btn-3d');
            app.cameraManager.setView('3d');
        }
    });
    await new Promise(r => setTimeout(r, 1500));

    // 4. Test Preset: Ocean Only (Test A)
    console.log('Testing Preset: Ocean Only...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app && app.gui) {
            app.gui.params.showOcean = true;
            app.gui.params.showSeabed = false;
            app.gui.params.showLand = false;
            app.gui.params.showCoastline = false;
            app.gui.syncLayerVisibility();
        }
    });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_ocean_only.png' });
    console.log('Captured screenshot_ocean_only.png');

    // 5. Test Preset: Seabed Only (Test B)
    console.log('Testing Preset: Seabed Only...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app && app.gui) {
            app.gui.params.showOcean = false;
            app.gui.params.showSeabed = true;
            app.gui.params.showLand = false;
            app.gui.params.showCoastline = true;
            app.gui.syncLayerVisibility();
        }
    });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_seabed_only.png' });
    console.log('Captured screenshot_seabed_only.png');

    // 6. Test Preset: Land + Seabed (Test C)
    console.log('Testing Preset: Land + Seabed...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app && app.gui) {
            app.gui.params.showOcean = false;
            app.gui.params.showSeabed = true;
            app.gui.params.showLand = true;
            app.gui.params.showCoastline = true;
            app.gui.syncLayerVisibility();
        }
    });
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_land_seabed.png' });
    console.log('Captured screenshot_land_seabed.png');

    // Restore All Layers
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app && app.gui) {
            app.gui.params.showOcean = true;
            app.gui.params.showSeabed = true;
            app.gui.params.showLand = true;
            app.gui.params.showCoastline = true;
            app.gui.syncLayerVisibility();
        }
    });
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_all_layers.png' });
    console.log('Captured screenshot_all_layers.png');

    // 7. Test Vertical Exaggeration 10x
    console.log('Testing Vertical Exaggeration 10x...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.gui.params.verticalExaggeration = 10;
            app.onExaggerationChange(10);
        }
    });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_10x.png' });
    console.log('Captured screenshot_10x.png');

    // 8. Test Vertical Exaggeration 1x
    console.log('Testing Vertical Exaggeration 1x...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.gui.params.verticalExaggeration = 1;
            app.onExaggerationChange(1);
        }
    });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_1x.png' });
    console.log('Captured screenshot_1x.png');

    // Restore 70x Exaggeration
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.gui.params.verticalExaggeration = 70;
            app.onExaggerationChange(70);
        }
    });
    await new Promise(r => setTimeout(r, 2000));

    // 9. Test interactive probe click
    console.log('Testing interactive probe click...');
    await page.mouse.click(750, 420);
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_probe.png' });
    console.log('Captured screenshot_probe.png');

    // 10. Test switching dataset to real temperature.nc
    console.log('Testing dataset switch to real temperature.nc...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.onDatasetChange('temperature.nc');
        }
    });
    await new Promise(r => setTimeout(r, 3500));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_real_temp.png' });
    console.log('Captured screenshot_real_temp.png');

    // 11. Test diagnostic color mode (bathymetry)
    console.log('Testing diagnostic color mode (bathymetry)...');
    await page.evaluate(() => {
        const app = window.appInstance;
        if (app) {
            app.gui.params.colorMode = 'bathymetry';
            app.onColorModeChange('bathymetry');
        }
    });
    await new Promise(r => setTimeout(r, 2500));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_color_bathymetry.png' });
    console.log('Captured screenshot_color_bathymetry.png');

    await browser.close();
    console.log('E2E Render test completed successfully! Errors:', errors.length);
    if (errors.length > 0) {
        process.exit(1);
    }
})();
