/**
 * One-time admin tool: link a POS organization that existed before CRM/Product-Contract
 * SSO was added to the CRM tenant that should now own it.
 *
 * Without this, the first time someone from that CRM tenant signs in through CRM, POS has
 * no way to know the organization already exists and creates a brand-new, empty one instead.
 *
 * New users within an already-linked organization are matched and linked automatically by
 * email on their first CRM sign-in (see platform-auth.service.ts) — this script is only for
 * the organization-level link, which has no automatic signal to match on.
 *
 * Usage:
 *   pnpm --filter api exec tsx prisma/link-platform-tenant.ts --org-slug=<pos-org-slug> --tenant-id=<crm-tenant-uuid>
 *   pnpm --filter api exec tsx prisma/link-platform-tenant.ts --org-slug=<pos-org-slug> --tenant-id=<crm-tenant-uuid> --dry-run
 */
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

loadEnv({ path: '../../.env' });

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match?.slice(prefix.length);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const orgSlug = arg('org-slug');
  const tenantId = arg('tenant-id');
  const dryRun = process.argv.includes('--dry-run');

  if (!orgSlug || !tenantId) {
    console.error('Usage: tsx prisma/link-platform-tenant.ts --org-slug=<slug> --tenant-id=<uuid> [--dry-run]');
    process.exitCode = 1;
    return;
  }
  if (!UUID_RE.test(tenantId)) {
    console.error(`--tenant-id "${tenantId}" does not look like a CRM tenant UUID.`);
    process.exitCode = 1;
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const organization = await prisma.organization.findUnique({ where: { slug: orgSlug } });
    if (!organization) {
      console.error(`No POS organization found with slug "${orgSlug}".`);
      process.exitCode = 1;
      return;
    }
    if (organization.platformTenantId && organization.platformTenantId !== tenantId) {
      console.error(
        `Organization "${orgSlug}" is already linked to a different CRM tenant (${organization.platformTenantId}). ` +
          'Refusing to overwrite; unlink it manually first if this is intentional.',
      );
      process.exitCode = 1;
      return;
    }
    const existingWithTenant = await prisma.organization.findUnique({ where: { platformTenantId: tenantId } });
    if (existingWithTenant && existingWithTenant.id !== organization.id) {
      console.error(
        `CRM tenant ${tenantId} is already linked to a different POS organization (slug "${existingWithTenant.slug}"). ` +
          'A CRM tenant can only own one POS organization.',
      );
      process.exitCode = 1;
      return;
    }
    if (organization.platformTenantId === tenantId) {
      console.log(`Organization "${orgSlug}" is already linked to CRM tenant ${tenantId}. Nothing to do.`);
      return;
    }

    console.log(`About to link POS organization "${orgSlug}" (${organization.id}) to CRM tenant ${tenantId}.`);
    if (dryRun) {
      console.log('--dry-run set; no changes made.');
      return;
    }
    await prisma.organization.update({ where: { id: organization.id }, data: { platformTenantId: tenantId } });
    console.log('Linked. The next CRM sign-in for that tenant will land on this organization instead of creating a new one.');
    console.log(
      'Existing POS users in this organization will auto-link to their CRM identity by matching email on their first CRM sign-in.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
