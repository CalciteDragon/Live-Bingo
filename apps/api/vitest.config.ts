import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@bingo/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@bingo/engine': resolve(__dirname, '../../packages/engine/src/index.ts'),
    },
  },
});
