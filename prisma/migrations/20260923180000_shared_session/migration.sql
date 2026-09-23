-- Shared session slice. Column names match the school app so a received row
-- can be stored as-is. The host start URL and password hashes are not here.

CREATE TYPE "shared_role" AS ENUM ('STUDENT', 'TUTOR', 'ADMIN', 'SUPER_ADMIN', 'PRINCIPAL', 'PARENT');

CREATE TYPE "shared_session_status" AS ENUM ('SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED');

CREATE TYPE "shared_attendance_status" AS ENUM ('UNMARKED', 'PRESENT', 'LATE', 'ABSENT');

CREATE TABLE "shared_school" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',

    CONSTRAINT "shared_school_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shared_school_slug_key" ON "shared_school"("slug");

CREATE TABLE "shared_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "shared_role" NOT NULL,
    "schoolId" TEXT,

    CONSTRAINT "shared_user_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shared_user_email_key" ON "shared_user"("email");

CREATE INDEX "shared_user_schoolId_idx" ON "shared_user"("schoolId");

CREATE TABLE "shared_pod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_pod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shared_pod_tutorId_idx" ON "shared_pod"("tutorId");

CREATE TABLE "shared_pod_membership" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "shared_pod_membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shared_pod_membership_podId_studentId_key" ON "shared_pod_membership"("podId", "studentId");

CREATE INDEX "shared_pod_membership_studentId_idx" ON "shared_pod_membership"("studentId");

CREATE TABLE "shared_session" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 60,
    "status" "shared_session_status" NOT NULL DEFAULT 'SCHEDULED',
    "zoomJoinUrl" TEXT,

    CONSTRAINT "shared_session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shared_session_podId_idx" ON "shared_session"("podId");

CREATE INDEX "shared_session_tutorId_idx" ON "shared_session"("tutorId");

CREATE TABLE "shared_session_attendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "shared_attendance_status" NOT NULL DEFAULT 'UNMARKED',
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "shared_session_attendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shared_session_attendance_sessionId_studentId_key" ON "shared_session_attendance"("sessionId", "studentId");

CREATE INDEX "shared_session_attendance_studentId_idx" ON "shared_session_attendance"("studentId");

CREATE TABLE "shared_link" (
    "id" BIGSERIAL NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "ops_id" BIGINT NOT NULL,
    "shared_id" TEXT NOT NULL,

    CONSTRAINT "shared_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_shared_link" ON "shared_link"("entity_type", "ops_id");

CREATE INDEX "ix_shared_link_shared" ON "shared_link"("shared_id");

CREATE TABLE "outbound_change" (
    "id" BIGSERIAL NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "session_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_change_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_outbound_change_created" ON "outbound_change"("created_at");

CREATE TABLE "applied_inbound" (
    "id" BIGSERIAL NOT NULL,
    "source_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applied_inbound_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "applied_inbound_source_id_key" ON "applied_inbound"("source_id");

ALTER TABLE "shared_user" ADD CONSTRAINT "shared_user_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "shared_school"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shared_pod" ADD CONSTRAINT "shared_pod_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "shared_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shared_pod_membership" ADD CONSTRAINT "shared_pod_membership_podId_fkey" FOREIGN KEY ("podId") REFERENCES "shared_pod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shared_pod_membership" ADD CONSTRAINT "shared_pod_membership_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "shared_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shared_session" ADD CONSTRAINT "shared_session_podId_fkey" FOREIGN KEY ("podId") REFERENCES "shared_pod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shared_session" ADD CONSTRAINT "shared_session_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "shared_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shared_session_attendance" ADD CONSTRAINT "shared_session_attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "shared_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shared_session_attendance" ADD CONSTRAINT "shared_session_attendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "shared_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
