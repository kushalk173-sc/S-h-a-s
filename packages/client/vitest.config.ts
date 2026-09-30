import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The blind-answer symmetry test reads computed styles off real DOM nodes, so
// the default `node` environment is not enough: we need jsdom's CSSOM.
//
// `css: true` is REQUIRED here, not a nicety. Without it Vitest stubs CSS
// imports out, every computed style comes back as the jsdom default, and the
// equality assertion would pass VACUOUSLY while guarding nothing. There is a
// test in blindAnswer.test.tsx that asserts the CSS actually reached the
// document, precisely so this flag can never be silently dropped.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
