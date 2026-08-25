import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@dsh-overdrive/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.dsh-plugin-builds/**',
      '**/.pnpm-store/**',
    ],
  },
});
