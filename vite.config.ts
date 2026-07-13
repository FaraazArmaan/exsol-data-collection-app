import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const isNetlifyDev = process.env.NETLIFY_LOCAL === 'true';

export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  plugins: [react()],
  resolve: {
    alias: {
      '@registry': path.resolve(__dirname, 'src/modules/registry'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    hmr: isNetlifyDev ? false : undefined,
    proxy: { '/api': 'http://localhost:8888' },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
