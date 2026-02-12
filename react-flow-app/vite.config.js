import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/compost-coordinator/', // Replace with your repo name
  server: {
    port: 5174,
  },
})
