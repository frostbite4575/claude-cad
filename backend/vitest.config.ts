import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

export default defineConfig({
  define: {
    // opencascade.js WASM factory uses __dirname internally.
    // Provide a shim since Vite transforms to ESM where __dirname doesn't exist.
    __dirname: JSON.stringify(dirname(fileURLToPath(import.meta.url))),
    __filename: JSON.stringify(fileURLToPath(import.meta.url)),
  },
  test: {
    server: {
      deps: {
        inline: ['opencascade.js'],
      },
    },
  },
});
