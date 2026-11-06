import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the same Vercel deployment as the API, under /dashboard/.
export default defineConfig({
  base: '/dashboard/',
  plugins: [react()],
  build: { outDir: '../public/dashboard', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5174 },
  preview: { port: 4174 },
});
