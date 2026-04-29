-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'school_code';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
