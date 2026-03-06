-- Rollback script for Kit Bundling feature
-- Run this if you need to revert the database changes
-- WARNING: This will delete all kit hierarchy data!

BEGIN;

-- Remove indexes added in migration
DROP INDEX IF EXISTS "Kit_parentKitId_idx";
DROP INDEX IF EXISTS "Kit_organizationId_parentKitId_idx";
DROP INDEX IF EXISTS "Booking_organizationId_status_from_to_idx";
DROP INDEX IF EXISTS "Asset_kitId_idx";

-- Remove constraints
ALTER TABLE "Kit" DROP CONSTRAINT IF EXISTS "Kit_no_self_reference";
ALTER TABLE "Kit" DROP CONSTRAINT IF EXISTS "Kit_parentKitId_fkey";

-- Remove column (WARNING: This will delete all hierarchy data!)
ALTER TABLE "Kit" DROP COLUMN IF EXISTS "parentKitId";

COMMIT;

-- Verify rollback (should return no results)
-- \d Kit | grep parentKitId
