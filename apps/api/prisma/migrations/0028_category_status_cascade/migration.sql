-- Plan 14: a subcategory can never be active while any ancestor is disabled. Before this rule existed, disabling
-- a top-level category left its subcategories active; bring existing data in line once. Data-only migration.

WITH RECURSIVE disabled_tree AS (
    SELECT "id" FROM "categories" WHERE "status" = 'DISABLED'
    UNION
    SELECT child."id"
    FROM "categories" child
    JOIN disabled_tree parent ON child."parent_id" = parent."id"
)
UPDATE "categories"
SET "status" = 'DISABLED', "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "id" FROM disabled_tree) AND "status" <> 'DISABLED';
