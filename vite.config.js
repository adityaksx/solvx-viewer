import { defineConfig } from 'vite';

export default defineConfig({
  root: 'frontend',
  server: {
    host: '127.0.0.1',
    port: 5500,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
