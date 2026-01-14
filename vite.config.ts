import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// https://vite.dev/config/
export default defineConfig({
    server: {
      host: "0.0.0.0", // Allow external connections
      port: 5173,
      strictPort: false,
      // Proxy API requests to Express server running on port 3000
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Split Three.js into its own chunk (large library ~600KB)
            'three': ['three'],
            // Split Liveblocks into its own chunk
            'liveblocks': ['@liveblocks/client', '@liveblocks/react'],
            // Split React into its own chunk
            'react': ['react', 'react-dom'],
          },
        },
      },
      chunkSizeWarningLimit: 1000, // Increase limit to 1MB for chunks
    },
    plugins: [
      react(),
  ],
})
