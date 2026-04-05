-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN "teacherSeenJoinAt" TIMESTAMP(3);

-- Существующие записи не считаем «новыми» для учителя
UPDATE "Enrollment" SET "teacherSeenJoinAt" = "joinedAt" WHERE "teacherSeenJoinAt" IS NULL;
