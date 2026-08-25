import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@dsh-overdrive/sdk': fileURLToPath(new URL('./packages/sdk/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // 根锚定：只收集本仓库 packages/*/test，避免误扫 .dsh-plugin-builds 等嵌套目录里
    // 同名 packages/<x>/test 的其他项目测试（vitest glob 默认匹配任意深度）。
    include: ['./packages/*/test/**/*.test.ts'],
  },
});
