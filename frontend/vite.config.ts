import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Read VITE_API_URL from the repo root .env (copied from .env.example, contract section 7).
  // In Docker the build arg wins; with no .env at all the app falls back to /api/v1.
  envDir: '..',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
