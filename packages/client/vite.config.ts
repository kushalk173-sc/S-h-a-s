import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the Shasn client. `@shasn/engine` is deliberately NOT aliased:
// the board is pure presentational and imports nothing from the engine, so the dev
// server never needs the engine to compile. See src/board/types.ts.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
