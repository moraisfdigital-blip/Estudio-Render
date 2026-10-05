import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Em dev o Vite roda em :5173 e repassa /api para o FastAPI em :8000.
// Em produção o próprio FastAPI serve este build (single-service).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // `localhost` sem host explícito faz o Vite escutar só em IPv6 (`[::1]`)
    // nesta máquina, e o navegador que resolve `localhost` para 127.0.0.1
    // leva porta na cara. Escutar em 0.0.0.0 atende os dois.
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
