import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 3001,
    // Dev-only same-origin path for Supabase Auth. This avoids local browser
    // requests being intercepted or re-routed before they reach warnoto.com.
    proxy: {
      "/supabase": {
        target: "https://warnoto.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/supabase/, "")
      }
    },
    // E2E owns its browser lifecycle. Never open a real user browser there.
    open: mode === 'e2e' ? false : true
  }
}))
