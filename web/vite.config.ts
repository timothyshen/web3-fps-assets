import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // The lazily loaded Privy chunk is ~2.2 MB minified; raise the warning
    // threshold so a clean build stays clean. That chunk is only downloaded
    // at runtime when VITE_PRIVY_APP_ID is set.
    chunkSizeWarningLimit: 2400,
  },
})
