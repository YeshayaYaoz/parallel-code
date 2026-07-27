import { defineConfig } from 'vitest/config';

// Needed so Vitest resolves *this* config instead of walking up to the repo
// root's vitest.config.ts. That upward search is Vitest's normal behavior
// when a directory has no config of its own, and it's fatal in CI (not
// locally, where the root's node_modules already happens to exist): CI's
// cloud-backend job runs `npm ci` scoped to this directory only, so the root
// config's `import solidPlugin from 'vite-plugin-solid'` and even
// `vitest/config` itself have nothing installed at the repo root to resolve
// against, and the whole job fails with ERR_MODULE_NOT_FOUND before a single
// test runs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
