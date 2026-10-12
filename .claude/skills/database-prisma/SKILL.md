# Database and Prisma

Treat `apps/api/prisma/schema.prisma` and committed migrations as one contract. Generate the client after schema changes, use mapped snake_case names deliberately, never create application tables at boot, and run Prisma validation plus migration-diff checks against a disposable database.
