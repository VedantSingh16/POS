-- SQLite allowed NULL in the composite user_roles key. PostgreSQL primary keys do not.
-- Keep organization-scoped assignments nullable and enforce one assignment per scope.
ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;
ALTER TABLE user_roles ALTER COLUMN scope_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_assignment_unique
  ON user_roles (user_id, role_id, scope_type, scope_id) NULLS NOT DISTINCT;
