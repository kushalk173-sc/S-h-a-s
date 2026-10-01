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
    /**
     * THE `/ws` PROXY IS LOAD-BEARING IN DEV, NOT A CONVENIENCE.
     *
     * `net/connection.ts:defaultUrl()` derives the socket from the page's OWN
     * origin, which is correct in production because `server/src/main.ts` serves
     * `packages/client/dist` from the same port as the socket — one origin, one
     * host, no configuration. In dev the page is served by Vite on a different
     * port from the match server, so without this rule the client opens
     * `ws://<vite-host>:5174/ws`, which Vite answers with an HTTP 404 for the
     * upgrade, the socket never opens, and `send()` returns `false` and drops every
     * frame on the floor.
     *
     * The symptom is the worst kind: no error toast, no console error, no red dot —
     * `Connection.#onerror` is deliberately empty and `onclose` schedules a silent
     * retry with backoff. The lobby simply renders, CREATE ROOM does nothing, and
     * the client looks like it has a dead button. Nothing short of opening the
     * browser would ever find it.
     */
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
