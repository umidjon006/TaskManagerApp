import { defineConfig } from 'vite';

// UI manbasi src/ui/ da; build natijasi www/ ga tushadi (Capacitor webDir).
export default defineConfig({
  root: 'src/ui',
  publicDir: 'public',
  build: {
    outDir: '../../www',
    emptyOutDir: true,
  },
});
