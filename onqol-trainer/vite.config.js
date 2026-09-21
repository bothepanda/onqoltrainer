import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // локальный API учебных сессий: npm run dev:api (STUDY_MOCK=1 — заглушка вместо модели)
      "/api/study": { target: "http://localhost:3001" },
      "/anthropic": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anthropic/, ""),
      },
    },
  },
})
