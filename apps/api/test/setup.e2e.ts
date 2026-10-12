import { Client } from 'pg';

// Resets the disposable test tenant between tests.
//
// Business records reference users, stores, locations and variants with ON DELETE NO ACTION on purpose:
// the database must refuse to delete a variant that has been sold. Because those checks run per
// cascade level, deleting the organisation directly can trip them, so the transactional tables are
// removed first, children before parents. Everything else cascades from the organisation.
const TRANSACTIONAL_TABLES = [
  'returns', // cascades return_lines
  'sales', // cascades sale_lines, sale_payments
  'inventory_movements',
  'transfers', // cascades transfer_lines
  'held_sales',
  'approvals',
  'cash_movements',
  'register_sessions',
];

beforeEach(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const orgs = await client.query(
      "SELECT id FROM organizations WHERE slug = ANY($1) OR slug LIKE 'tenant-b-%'",
      [['test-organisation', 'test-organisation-b']],
    );
    for (const { id: organizationId } of orgs.rows) {
      for (const table of TRANSACTIONAL_TABLES) {
        await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
      }
      await client.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
});
