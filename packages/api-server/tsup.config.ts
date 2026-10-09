import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/start.ts', 'src/bin/admin.ts', 'src/bin/import-ncp.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
