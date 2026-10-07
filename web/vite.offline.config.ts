import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The offline app that ships inside the Android shell: src/offline, built to
// mobile/www/offline next to the connect screen. Relative asset paths
// (`base: './'`) because the shell serves it from a subfolder, not from /.
// The engine (mobile/www/offline/engine, fetched by mobile/build-apk.sh)
// lives in the same folder, so the output directory is not emptied.
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: '../mobile/www/offline',
    emptyOutDir: false,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: 'offline.html' },
  },
});
