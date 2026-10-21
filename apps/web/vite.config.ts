import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:47211', changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { grid: ['ag-grid-community', 'ag-grid-react'] },
      },
    },
  },
})
