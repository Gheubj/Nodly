-- AlterTable
ALTER TABLE "ClassScheduleSlot" ADD COLUMN "weeklySeriesId" TEXT;

-- CreateIndex
CREATE INDEX "ClassScheduleSlot_weeklySeriesId_idx" ON "ClassScheduleSlot"("weeklySeriesId");
