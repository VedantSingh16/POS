import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node_modules/.bin/tsx prisma/seed.ts",
  },
  datasource: {
    // Generate can run during an image build before runtime environment variables exist.
    // Migrate/deploy still receives the real DATABASE_URL from the container environment.
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/placeholder",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/deltcrm_pos_shadow",
  },
});
