import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true as any,
    headers: { 'X-Frame-Options': 'ALLOWALL' } as any,
    cors: true,
    hmr: { host: 'localhost' } as any,
    proxy: {
      '/api': { target: 'http://localhost:4433', changeOrigin: true },
      '/health': { target: 'http://localhost:4433', changeOrigin: true },
      '/ops': { target: 'ws://localhost:4433', ws: true, changeOrigin: true },
      '/fast': { target: 'ws://localhost:4433', ws: true, changeOrigin: true }
    }
  },
  preview: { host: '0.0.0.0', port: 4173 }
});
