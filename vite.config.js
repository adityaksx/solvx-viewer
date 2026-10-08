import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  server: {
    host: '127.0.0.1',
    port: 5500,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        // /api/apiClient.js is a frontend module, not a FastAPI endpoint.
        bypass(req) {
          const path = req.url?.split('?')[0];
          if (path === '/api/apiClient.js') return req.url;
        }
      }
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
