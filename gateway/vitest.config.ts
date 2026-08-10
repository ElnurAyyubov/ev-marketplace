import { defineConfig } from 'vitest/config';

// Without this, vitest's default include glob also picks up the compiled
// *.test.js files under dist/ (tsconfig's rootDir is src/, so `tsc` compiles
// tests 1:1 alongside source) and fails on each with a CJS/ESM mismatch --
// pre-existing, unrelated to any one feature; surfaces as soon as `npm run
// build` has been run at least once before `npm test`.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'dist/**'],
  },
});
