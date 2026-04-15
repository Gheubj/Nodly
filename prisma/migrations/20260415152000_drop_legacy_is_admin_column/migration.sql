-- Remove legacy admin flag after migrating to UserRole.admin.
ALTER TABLE "User" DROP COLUMN IF EXISTS "isAdmin";
