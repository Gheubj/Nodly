-- Add enum value only. PostgreSQL forbids using a new enum value in the same
-- transaction as ALTER TYPE ... ADD VALUE (E55P04). Data migration follows in the next migration.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'admin';
