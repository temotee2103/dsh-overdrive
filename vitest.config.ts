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
    // 排除工作区里其他 DSH 项目的构建/存储目录（vitest glob 会匹配任意深度的 packages/ 段）
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.dsh-plugin-builds/**',
      '**/.pnpm-store/**',
    ],
  },
});
