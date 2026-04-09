-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "scheduleSlotId" TEXT;

-- CreateIndex
CREATE INDEX "Assignment_scheduleSlotId_idx" ON "Assignment"("scheduleSlotId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_scheduleSlotId_fkey" FOREIGN KEY ("scheduleSlotId") REFERENCES "ClassScheduleSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
