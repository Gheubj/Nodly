-- Runs in a separate migration transaction so "admin" is safe to use.
UPDATE "User"
SET "role" = 'admin'::"UserRole"
WHERE "isAdmin" = true;
