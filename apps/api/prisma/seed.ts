import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { foundationConfigFromEnv, seedFoundation } from '../src/bootstrap/foundation.js';

loadEnv({ path: '../../.env' });

// Provisions the bootstrap organisation, permission catalogue, system roles and first administrator.
// The API runs the same routine on start-up; this entry point exists for `prisma db seed` and the container CMD.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
try {
  const { organizationId } = await seedFoundation(prisma, foundationConfigFromEnv());
  console.log(`Seeded organisation ${organizationId}`);
} finally {
  await prisma.$disconnect();
}
