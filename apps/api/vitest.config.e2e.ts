import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { config as loadEnv } from 'dotenv';

process.env.NODE_ENV = 'test';
loadEnv({ path: '../../.env' });
process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.POS_ORGANIZATION_NAME = 'Test Organisation';
process.env.POS_ORGANIZATION_SLUG = 'test-organisation';
process.env.POS_MAX_STORES = '2';
process.env.POS_ORG_ADMIN_EMAIL = 'admin@test.pos';
process.env.POS_ORG_ADMIN_PASSWORD = 'Test-Admin-Password-2026!';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: ['./test/setup.e2e.ts'],
    hookTimeout: 30000,
  },
});
