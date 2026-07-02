import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      // All API calls go to the Node.js backend on :8080
      '/api': {
        target: process.env.PDOS_BACKEND_URL || 'http://localhost:8080',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
