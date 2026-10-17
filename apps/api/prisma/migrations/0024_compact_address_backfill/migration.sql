-- Existing structured Oman addresses are kept in address_details for compatibility,
-- while receipts and the new UI use the compact one-line address.
UPDATE "organizations"
SET "address" = trim(both ', ' from concat_ws(', ',
  nullif("address_details"->>'unit', ''),
  CASE WHEN nullif("address_details"->>'building', '') IS NULL THEN NULL ELSE concat('Building ', "address_details"->>'building') END,
  nullif("address_details"->>'way', ''),
  nullif("address_details"->>'area', ''),
  CASE WHEN nullif("address_details"->>'landmark', '') IS NULL THEN NULL ELSE concat('Near ', "address_details"->>'landmark') END,
  CASE WHEN nullif("address_details"->>'poBox', '') IS NULL THEN NULL ELSE concat('P.O. Box ', "address_details"->>'poBox') END
))
WHERE "address_details" <> '{}'::jsonb
  AND trim(both ' ' from concat_ws('', "address_details"->>'unit', "address_details"->>'building', "address_details"->>'way', "address_details"->>'area', "address_details"->>'landmark', "address_details"->>'poBox')) <> '';

UPDATE "stores"
SET "address" = trim(both ', ' from concat_ws(', ',
  nullif("address_details"->>'unit', ''),
  CASE WHEN nullif("address_details"->>'building', '') IS NULL THEN NULL ELSE concat('Building ', "address_details"->>'building') END,
  nullif("address_details"->>'way', ''),
  nullif("address_details"->>'area', ''),
  CASE WHEN nullif("address_details"->>'landmark', '') IS NULL THEN NULL ELSE concat('Near ', "address_details"->>'landmark') END,
  CASE WHEN nullif("address_details"->>'poBox', '') IS NULL THEN NULL ELSE concat('P.O. Box ', "address_details"->>'poBox') END
))
WHERE "address_details" <> '{}'::jsonb
  AND trim(both ' ' from concat_ws('', "address_details"->>'unit', "address_details"->>'building', "address_details"->>'way', "address_details"->>'area', "address_details"->>'landmark', "address_details"->>'poBox')) <> '';
