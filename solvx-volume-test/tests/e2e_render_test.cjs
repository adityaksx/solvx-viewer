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

    // Wait 3 seconds for initial synthetic volume to render
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_synthetic.png' });
    console.log('Captured screenshot_synthetic.png');

    // Test clicking the ocean to test probe
    console.log('Testing interactive probe click...');
    await page.mouse.click(650, 420);
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_probe.png' });
    console.log('Captured screenshot_probe.png');

    // Test switching dataset to real temperature.nc via page script
    console.log('Testing dataset switch to real temperature.nc...');
    await page.evaluate(() => {
        const app = window.appInstance || document.querySelector('canvas')?.__app;
        // Trigger dataset switch via UI controller if exposed or reload
        const datasetSelect = document.querySelector('.lil-gui select');
        if (datasetSelect) {
            datasetSelect.value = 'temperature.nc';
            datasetSelect.dispatchEvent(new Event('change'));
        }
    });

    await new Promise(r => setTimeout(r, 3500));
    await page.screenshot({ path: 'solvx-volume-test/frontend/screenshot_real_temp.png' });
    console.log('Captured screenshot_real_temp.png');

    await browser.close();
    console.log('E2E Render test completed successfully! Errors:', errors.length);
    if (errors.length > 0) {
        process.exit(1);
    }
})();
