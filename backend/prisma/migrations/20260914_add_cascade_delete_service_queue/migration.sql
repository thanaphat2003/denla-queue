-- AddForeignKey
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_queues" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ticket_no" TEXT NOT NULL,
    "service_id" INTEGER NOT NULL,
    "user_name" TEXT NOT NULL,
    "user_phone" TEXT NOT NULL,
    "user_email" TEXT NOT NULL,
    "contact_subject" TEXT NOT NULL DEFAULT '',
    "contact_subject_en" TEXT,
    "language" TEXT NOT NULL DEFAULT 'TH',
    "queue_type" TEXT NOT NULL DEFAULT 'WALK_IN',
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "counter_no" INTEGER,
    "served_by" TEXT,
    "service_started_at" DATETIME,
    "completed_at" DATETIME,
    "booking_date" DATETIME,
    "time_slot_id" INTEGER,
    "is_checked_in" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" DATETIME,
    "booking_expired" BOOLEAN NOT NULL DEFAULT false,
    "is_email_notified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "queues_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "queues_time_slot_id_fkey" FOREIGN KEY ("time_slot_id") REFERENCES "time_slots" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_queues" SELECT * FROM "queues";
DROP TABLE "queues";
ALTER TABLE "new_queues" RENAME TO "queues";

CREATE INDEX "queues_service_id_status_booking_date_idx" ON "queues"("service_id", "status", "booking_date");

PRAGMA foreign_keys=ON;
