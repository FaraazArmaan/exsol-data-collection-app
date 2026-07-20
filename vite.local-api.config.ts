import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const functionsDir = path.resolve(__dirname, 'netlify/functions');
const explicitApiRoutes = fs.readdirSync(functionsDir)
  .filter((file) => file.endsWith('.ts'))
  .flatMap((file) => {
    const route = fs.readFileSync(path.join(functionsDir, file), 'utf8')
      .match(/path:\s*['"](\/api\/[^'"]+)['"]/)?.[1];
    return route ? [new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`)] : [];
  });

export function rewriteLocalApiPath(requestPath: string) {
  const url = new URL(requestPath, 'http://localhost');
  return explicitApiRoutes.some((route) => route.test(url.pathname))
    ? requestPath
    : `/.netlify/functions${requestPath.slice('/api'.length)}`;
}

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
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:9999',
        rewrite: rewriteLocalApiPath,
      },
    },
  },
});
