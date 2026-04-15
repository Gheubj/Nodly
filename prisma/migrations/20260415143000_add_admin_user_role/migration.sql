-- Add dedicated admin role and migrate legacy admin flags.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'admin';

UPDATE "User"
SET "role" = 'admin'
WHERE "isAdmin" = true;
