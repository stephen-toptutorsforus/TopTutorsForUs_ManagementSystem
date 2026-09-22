-- The occurrence owns its own meeting. The series already had this column;
-- a standalone session has no series, and a series whose days differ has a
-- different Zoom meeting on each row.
ALTER TABLE "session_occurrence" ADD COLUMN "classroom_config" JSONB NOT NULL DEFAULT '{}';
