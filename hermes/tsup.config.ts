import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'mcp/server': 'src/mcp/server.ts',
    'monitor/run': 'src/monitor/run.ts',
    'db/migrate': 'src/db/migrate.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
})
