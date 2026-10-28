import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser requests stay on the preview origin. Only Vite talks to this backend,
// which can be a local process or the Compose service name inside Docker.
const backend = process.env.OPENPATH_BACKEND_URL || 'http://127.0.0.1:4433'
const proxy = {
  '/api': { target: backend, changeOrigin: true, xfwd: true },
  '/health': { target: backend, changeOrigin: true, xfwd: true },
  '/ops': { target: backend, ws: true, changeOrigin: true, xfwd: true },
  '/fast': { target: backend, ws: true, changeOrigin: true, xfwd: true },
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    proxy,
  },
})
