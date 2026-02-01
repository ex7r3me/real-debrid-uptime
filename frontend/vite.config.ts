import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/status': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
      '/cache': 'http://localhost:3000',
    },
  },
})
