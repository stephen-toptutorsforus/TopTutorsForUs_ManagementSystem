-- CreateEnum
CREATE TYPE "role" AS ENUM ('admin', 'regional_admin', 'instructor', 'student', 'parent', 'payer');

-- CreateEnum
CREATE TYPE "guardian_relationship" AS ENUM ('coach', 'observer', 'parent', 'teacher');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'pending_invite', 'active', 'bounced', 'disabled');

-- CreateEnum
CREATE TYPE "delivery_type" AS ENUM ('advanced_classroom', 'external_link', 'in_person');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('requested', 'rejected', 'scheduled', 'rescheduled', 'in_progress', 'completed', 'cancelled', 'missed');

-- CreateEnum
CREATE TYPE "recurrence_frequency" AS ENUM ('daily', 'weekly');

-- CreateEnum
CREATE TYPE "recurrence_end_mode" AS ENUM ('count', 'until');

-- CreateEnum
CREATE TYPE "participant_role" AS ENUM ('instructor', 'student', 'observer');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('unmarked', 'present', 'late', 'left_early', 'incomplete', 'absent', 'excused');

-- CreateEnum
CREATE TYPE "attendance_source" AS ENUM ('manual', 'bulk', 'classroom', 'system');

-- CreateEnum
CREATE TYPE "audit_category" AS ENUM ('session', 'series', 'attendance', 'user', 'permission', 'availability', 'credit', 'export');

-- CreateTable
CREATE TABLE "organization" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'US',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "logo_url" VARCHAR(500),
    "support_email" VARCHAR(320),
    "support_phone" VARCHAR(32),
    "features" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_availability" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "weekday" VARCHAR(3) NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "off_day" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "school_id" BIGINT,
    "day" DATE NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "off_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "email" VARCHAR(320),
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(32),
    "password_hash" VARCHAR(255),
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "timezone" VARCHAR(64),
    "grade" VARCHAR(32),
    "last_login_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role" "role" NOT NULL,
    "region_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_student" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "guardian_id" BIGINT NOT NULL,
    "student_id" BIGINT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "relationship" "guardian_relationship" NOT NULL DEFAULT 'parent',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guardian_student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_student" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "instructor_id" BIGINT NOT NULL,
    "student_id" BIGINT NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "instructor_student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_assignment" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "payer_id" BIGINT NOT NULL,
    "student_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payer_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "region" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "district" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "region_id" BIGINT,
    "name" VARCHAR(120) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "district_id" BIGINT,
    "name" VARCHAR(160) NOT NULL,
    "timezone" VARCHAR(64),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "school_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "region_id" BIGINT,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_specification" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "subject_id" BIGINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subject_specification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "school_id" BIGINT,
    "name" VARCHAR(160) NOT NULL,
    "address" TEXT,
    "capacity" INTEGER,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_group" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "program_id" BIGINT,
    "name" VARCHAR(160) NOT NULL,
    "capacity" INTEGER,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_member" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "group_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "member_role" VARCHAR(16) NOT NULL DEFAULT 'student',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "group_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_program" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "program_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_school" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "school_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_school_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_district" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "district_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_district_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_region" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "region_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_subject" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "instructor_id" BIGINT NOT NULL,
    "subject_id" BIGINT NOT NULL,
    "grade_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "instructor_subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_rule" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "instructor_id" BIGINT NOT NULL,
    "weekday" VARCHAR(3) NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "timezone" VARCHAR(64),
    "effective_from" DATE,
    "effective_until" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "availability_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exception" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "instructor_id" BIGINT NOT NULL,
    "day" DATE NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "start_time" TIME(6),
    "end_time" TIME(6),
    "timezone" VARCHAR(64),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "availability_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_off" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "instructor_id" BIGINT NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" VARCHAR(160),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_series" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "delivery_type" "delivery_type" NOT NULL,
    "default_duration_minutes" INTEGER NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "frequency" "recurrence_frequency" NOT NULL,
    "interval_n" INTEGER NOT NULL DEFAULT 1,
    "weekdays" JSONB NOT NULL,
    "start_date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_mode" "recurrence_end_mode" NOT NULL,
    "occurrence_count" INTEGER,
    "until_date" DATE,
    "default_instructor_id" BIGINT,
    "group_id" BIGINT,
    "program_id" BIGINT,
    "subject_id" BIGINT,
    "grade_id" BIGINT,
    "location_id" BIGINT,
    "location_detail" VARCHAR(500),
    "meeting_url" VARCHAR(1000),
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "classroom_config" JSONB NOT NULL,
    "created_by_id" BIGINT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_occurrence" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "series_id" BIGINT,
    "series_index" INTEGER,
    "detached_from_series" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "delivery_type" "delivery_type" NOT NULL,
    "meeting_url" VARCHAR(1000),
    "location_id" BIGINT,
    "location_detail" VARCHAR(500),
    "scheduled_start" TIMESTAMPTZ(6) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(6) NOT NULL,
    "actual_start" TIMESTAMPTZ(6),
    "actual_end" TIMESTAMPTZ(6),
    "timezone" VARCHAR(64) NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'scheduled',
    "instructor_id" BIGINT,
    "group_id" BIGINT,
    "program_id" BIGINT,
    "subject_id" BIGINT,
    "grade_id" BIGINT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "payment_state" VARCHAR(24) NOT NULL DEFAULT 'unpaid',
    "invoice_ref" VARCHAR(24),
    "cancellation_reason" VARCHAR(64),
    "cancellation_note" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_id" BIGINT,
    "missed_reason" VARCHAR(64),
    "reschedule_reason" TEXT,
    "conflict_overridden" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" BIGINT,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_participant" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "session_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "role" "participant_role" NOT NULL,
    "attendance" "attendance_status" NOT NULL DEFAULT 'unmarked',
    "joined_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),
    "attended_minutes" INTEGER,
    "marked_by_id" BIGINT,
    "marked_at" TIMESTAMPTZ(6),
    "marked_source" "attendance_source",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "category" "audit_category" NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(48) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "entity_ref" VARCHAR(24),
    "actor_id" BIGINT,
    "actor_role" VARCHAR(32),
    "actor_label" VARCHAR(160),
    "changes" JSONB NOT NULL,
    "note" VARCHAR(240),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(240),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_ref_key" ON "organization"("ref");

-- CreateIndex
CREATE UNIQUE INDEX "organization_slug_key" ON "organization"("slug");

-- CreateIndex
CREATE INDEX "organization_availability_organization_id_idx" ON "organization_availability"("organization_id");

-- CreateIndex
CREATE INDEX "off_day_organization_id_idx" ON "off_day"("organization_id");

-- CreateIndex
CREATE INDEX "off_day_school_id_idx" ON "off_day"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_ref_key" ON "user_account"("ref");

-- CreateIndex
CREATE INDEX "user_account_organization_id_idx" ON "user_account"("organization_id");

-- CreateIndex
CREATE INDEX "ix_user_org_status" ON "user_account"("organization_id", "status");

-- CreateIndex
CREATE INDEX "user_role_organization_id_idx" ON "user_role"("organization_id");

-- CreateIndex
CREATE INDEX "user_role_user_id_idx" ON "user_role"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_role" ON "user_role"("user_id", "role", "region_id");

-- CreateIndex
CREATE INDEX "guardian_student_organization_id_idx" ON "guardian_student"("organization_id");

-- CreateIndex
CREATE INDEX "guardian_student_guardian_id_idx" ON "guardian_student"("guardian_id");

-- CreateIndex
CREATE INDEX "guardian_student_student_id_idx" ON "guardian_student"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_guardian_student" ON "guardian_student"("guardian_id", "student_id");

-- CreateIndex
CREATE INDEX "instructor_student_organization_id_idx" ON "instructor_student"("organization_id");

-- CreateIndex
CREATE INDEX "instructor_student_instructor_id_idx" ON "instructor_student"("instructor_id");

-- CreateIndex
CREATE INDEX "instructor_student_student_id_idx" ON "instructor_student"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_instructor_student" ON "instructor_student"("instructor_id", "student_id");

-- CreateIndex
CREATE INDEX "payer_assignment_organization_id_idx" ON "payer_assignment"("organization_id");

-- CreateIndex
CREATE INDEX "payer_assignment_payer_id_idx" ON "payer_assignment"("payer_id");

-- CreateIndex
CREATE INDEX "payer_assignment_student_id_idx" ON "payer_assignment"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_payer_student" ON "payer_assignment"("payer_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "region_ref_key" ON "region"("ref");

-- CreateIndex
CREATE INDEX "region_organization_id_idx" ON "region"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_region_org_name" ON "region"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "district_ref_key" ON "district"("ref");

-- CreateIndex
CREATE INDEX "district_organization_id_idx" ON "district"("organization_id");

-- CreateIndex
CREATE INDEX "district_region_id_idx" ON "district"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_district_org_name" ON "district"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "school_ref_key" ON "school"("ref");

-- CreateIndex
CREATE INDEX "school_organization_id_idx" ON "school"("organization_id");

-- CreateIndex
CREATE INDEX "school_district_id_idx" ON "school"("district_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_school_org_name" ON "school"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "program_ref_key" ON "program"("ref");

-- CreateIndex
CREATE INDEX "program_organization_id_idx" ON "program"("organization_id");

-- CreateIndex
CREATE INDEX "program_region_id_idx" ON "program"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_program_org_name" ON "program"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subject_ref_key" ON "subject"("ref");

-- CreateIndex
CREATE INDEX "subject_organization_id_idx" ON "subject"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_subject_org_name" ON "subject"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "subject_specification_ref_key" ON "subject_specification"("ref");

-- CreateIndex
CREATE INDEX "subject_specification_organization_id_idx" ON "subject_specification"("organization_id");

-- CreateIndex
CREATE INDEX "subject_specification_subject_id_idx" ON "subject_specification"("subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_subject_spec_name" ON "subject_specification"("subject_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grade_ref_key" ON "grade"("ref");

-- CreateIndex
CREATE INDEX "grade_organization_id_idx" ON "grade"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_grade_org_name" ON "grade"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "location_ref_key" ON "location"("ref");

-- CreateIndex
CREATE INDEX "location_organization_id_idx" ON "location"("organization_id");

-- CreateIndex
CREATE INDEX "location_school_id_idx" ON "location"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_location_org_name" ON "location"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "student_group_ref_key" ON "student_group"("ref");

-- CreateIndex
CREATE INDEX "student_group_organization_id_idx" ON "student_group"("organization_id");

-- CreateIndex
CREATE INDEX "student_group_program_id_idx" ON "student_group"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_group_org_name" ON "student_group"("organization_id", "name");

-- CreateIndex
CREATE INDEX "group_member_organization_id_idx" ON "group_member"("organization_id");

-- CreateIndex
CREATE INDEX "group_member_group_id_idx" ON "group_member"("group_id");

-- CreateIndex
CREATE INDEX "group_member_user_id_idx" ON "group_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_group_member" ON "group_member"("group_id", "user_id", "member_role");

-- CreateIndex
CREATE INDEX "user_program_organization_id_idx" ON "user_program"("organization_id");

-- CreateIndex
CREATE INDEX "user_program_user_id_idx" ON "user_program"("user_id");

-- CreateIndex
CREATE INDEX "user_program_program_id_idx" ON "user_program"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_program" ON "user_program"("user_id", "program_id");

-- CreateIndex
CREATE INDEX "user_school_organization_id_idx" ON "user_school"("organization_id");

-- CreateIndex
CREATE INDEX "user_school_user_id_idx" ON "user_school"("user_id");

-- CreateIndex
CREATE INDEX "user_school_school_id_idx" ON "user_school"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_school" ON "user_school"("user_id", "school_id");

-- CreateIndex
CREATE INDEX "user_district_organization_id_idx" ON "user_district"("organization_id");

-- CreateIndex
CREATE INDEX "user_district_user_id_idx" ON "user_district"("user_id");

-- CreateIndex
CREATE INDEX "user_district_district_id_idx" ON "user_district"("district_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_district" ON "user_district"("user_id", "district_id");

-- CreateIndex
CREATE INDEX "user_region_organization_id_idx" ON "user_region"("organization_id");

-- CreateIndex
CREATE INDEX "user_region_user_id_idx" ON "user_region"("user_id");

-- CreateIndex
CREATE INDEX "user_region_region_id_idx" ON "user_region"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_region" ON "user_region"("user_id", "region_id");

-- CreateIndex
CREATE INDEX "instructor_subject_organization_id_idx" ON "instructor_subject"("organization_id");

-- CreateIndex
CREATE INDEX "instructor_subject_instructor_id_idx" ON "instructor_subject"("instructor_id");

-- CreateIndex
CREATE INDEX "instructor_subject_subject_id_idx" ON "instructor_subject"("subject_id");

-- CreateIndex
CREATE INDEX "instructor_subject_grade_id_idx" ON "instructor_subject"("grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_instructor_subject" ON "instructor_subject"("instructor_id", "subject_id", "grade_id");

-- CreateIndex
CREATE UNIQUE INDEX "availability_rule_ref_key" ON "availability_rule"("ref");

-- CreateIndex
CREATE INDEX "availability_rule_organization_id_idx" ON "availability_rule"("organization_id");

-- CreateIndex
CREATE INDEX "availability_rule_instructor_id_idx" ON "availability_rule"("instructor_id");

-- CreateIndex
CREATE INDEX "ix_availability_rule_instructor" ON "availability_rule"("organization_id", "instructor_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "uq_availability_rule" ON "availability_rule"("instructor_id", "weekday", "start_time", "end_time");

-- CreateIndex
CREATE UNIQUE INDEX "availability_exception_ref_key" ON "availability_exception"("ref");

-- CreateIndex
CREATE INDEX "availability_exception_organization_id_idx" ON "availability_exception"("organization_id");

-- CreateIndex
CREATE INDEX "availability_exception_instructor_id_idx" ON "availability_exception"("instructor_id");

-- CreateIndex
CREATE INDEX "ix_availability_exception_day" ON "availability_exception"("organization_id", "instructor_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "time_off_ref_key" ON "time_off"("ref");

-- CreateIndex
CREATE INDEX "time_off_organization_id_idx" ON "time_off"("organization_id");

-- CreateIndex
CREATE INDEX "time_off_instructor_id_idx" ON "time_off"("instructor_id");

-- CreateIndex
CREATE INDEX "ix_time_off_range" ON "time_off"("organization_id", "instructor_id", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_series_ref_key" ON "session_series"("ref");

-- CreateIndex
CREATE INDEX "session_series_organization_id_idx" ON "session_series"("organization_id");

-- CreateIndex
CREATE INDEX "ix_series_org_created" ON "session_series"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "session_series_default_instructor_id_idx" ON "session_series"("default_instructor_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_occurrence_ref_key" ON "session_occurrence"("ref");

-- CreateIndex
CREATE INDEX "session_occurrence_organization_id_idx" ON "session_occurrence"("organization_id");

-- CreateIndex
CREATE INDEX "ix_session_org_window" ON "session_occurrence"("organization_id", "scheduled_start", "scheduled_end");

-- CreateIndex
CREATE INDEX "ix_session_org_status" ON "session_occurrence"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ix_session_series_index" ON "session_occurrence"("series_id", "series_index");

-- CreateIndex
CREATE INDEX "session_occurrence_series_id_idx" ON "session_occurrence"("series_id");

-- CreateIndex
CREATE INDEX "session_occurrence_instructor_id_idx" ON "session_occurrence"("instructor_id");

-- CreateIndex
CREATE INDEX "session_occurrence_location_id_idx" ON "session_occurrence"("location_id");

-- CreateIndex
CREATE INDEX "session_occurrence_program_id_idx" ON "session_occurrence"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_session_series_index" ON "session_occurrence"("series_id", "series_index");

-- CreateIndex
CREATE INDEX "session_participant_organization_id_idx" ON "session_participant"("organization_id");

-- CreateIndex
CREATE INDEX "session_participant_session_id_idx" ON "session_participant"("session_id");

-- CreateIndex
CREATE INDEX "session_participant_user_id_idx" ON "session_participant"("user_id");

-- CreateIndex
CREATE INDEX "ix_participant_user_session" ON "session_participant"("organization_id", "user_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_session_participant" ON "session_participant"("session_id", "user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "audit_event_ref_key" ON "audit_event"("ref");

-- CreateIndex
CREATE INDEX "audit_event_organization_id_idx" ON "audit_event"("organization_id");

-- CreateIndex
CREATE INDEX "ix_audit_subject" ON "audit_event"("organization_id", "entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_audit_actor" ON "audit_event"("organization_id", "actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_event_actor_id_idx" ON "audit_event"("actor_id");

-- AddForeignKey
ALTER TABLE "organization_availability" ADD CONSTRAINT "organization_availability_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "off_day" ADD CONSTRAINT "off_day_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "off_day" ADD CONSTRAINT "off_day_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account" ADD CONSTRAINT "user_account_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_student" ADD CONSTRAINT "guardian_student_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_student" ADD CONSTRAINT "guardian_student_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_student" ADD CONSTRAINT "guardian_student_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_student" ADD CONSTRAINT "instructor_student_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_student" ADD CONSTRAINT "instructor_student_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_student" ADD CONSTRAINT "instructor_student_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_assignment" ADD CONSTRAINT "payer_assignment_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_assignment" ADD CONSTRAINT "payer_assignment_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_assignment" ADD CONSTRAINT "payer_assignment_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "region" ADD CONSTRAINT "region_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "district" ADD CONSTRAINT "district_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "district" ADD CONSTRAINT "district_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school" ADD CONSTRAINT "school_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school" ADD CONSTRAINT "school_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program" ADD CONSTRAINT "program_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program" ADD CONSTRAINT "program_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject" ADD CONSTRAINT "subject_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_specification" ADD CONSTRAINT "subject_specification_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_specification" ADD CONSTRAINT "subject_specification_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade" ADD CONSTRAINT "grade_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group" ADD CONSTRAINT "student_group_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group" ADD CONSTRAINT "student_group_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "student_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_program" ADD CONSTRAINT "user_program_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_program" ADD CONSTRAINT "user_program_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_program" ADD CONSTRAINT "user_program_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_school" ADD CONSTRAINT "user_school_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_school" ADD CONSTRAINT "user_school_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_school" ADD CONSTRAINT "user_school_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "school"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_district" ADD CONSTRAINT "user_district_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_district" ADD CONSTRAINT "user_district_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_district" ADD CONSTRAINT "user_district_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_region" ADD CONSTRAINT "user_region_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_region" ADD CONSTRAINT "user_region_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_region" ADD CONSTRAINT "user_region_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_subject" ADD CONSTRAINT "instructor_subject_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_subject" ADD CONSTRAINT "instructor_subject_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_subject" ADD CONSTRAINT "instructor_subject_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_subject" ADD CONSTRAINT "instructor_subject_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rule" ADD CONSTRAINT "availability_rule_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rule" ADD CONSTRAINT "availability_rule_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exception" ADD CONSTRAINT "availability_exception_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exception" ADD CONSTRAINT "availability_exception_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_default_instructor_id_fkey" FOREIGN KEY ("default_instructor_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "student_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_series" ADD CONSTRAINT "session_series_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "session_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "student_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrence" ADD CONSTRAINT "session_occurrence_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participant" ADD CONSTRAINT "session_participant_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participant" ADD CONSTRAINT "session_participant_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session_occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participant" ADD CONSTRAINT "session_participant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_participant" ADD CONSTRAINT "session_participant_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Guarantees Prisma's schema language cannot express.
--
-- Everything above this line is generated from schema.prisma. Everything below
-- is written by hand and must be kept when the migration is regenerated.
-- ---------------------------------------------------------------------------

-- A GiST index over a scalar column plus a range needs btree_gist for the `=`
-- part of the constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- No instructor double-booking, and no room double-booking. These are the two
-- guarantees that cannot live in application code: a check followed by an
-- insert leaves a window in which a second request passes the same check.
--
-- `[)` — half-open, so a session ending at 15:00 and one starting at 15:00 do
-- not overlap and back-to-back bookings stay legal.
--
-- Partial, so a cancelled, rejected or missed session releases its slot, and an
-- unapproved request never holds one: it is not yet a commitment.
ALTER TABLE "session_occurrence"
ADD CONSTRAINT "ex_session_instructor_overlap"
EXCLUDE USING gist (
    instructor_id WITH =,
    tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
)
WHERE (
    instructor_id IS NOT NULL
    AND archived_at IS NULL
    AND status IN ('scheduled', 'rescheduled', 'in_progress')
);

ALTER TABLE "session_occurrence"
ADD CONSTRAINT "ex_session_location_overlap"
EXCLUDE USING gist (
    location_id WITH =,
    tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
)
WHERE (
    location_id IS NOT NULL
    AND archived_at IS NULL
    AND delivery_type = 'in_person'
    AND status IN ('scheduled', 'rescheduled', 'in_progress')
);

-- The audit trail is append-only, even to the process that writes it. A trail
-- the writer can rewrite is not a trail. `DO INSTEAD NOTHING` rather than a
-- revoked grant, so the guarantee holds whatever role the application connects
-- as.
--
-- This is also why `audit_event.actor_id` is not a foreign key: a referential
-- action would have to rewrite these rows, and the rules silently swallow it,
-- which made anybody who had ever acted undeletable.
CREATE RULE audit_event_no_update AS
    ON UPDATE TO audit_event DO INSTEAD NOTHING;

CREATE RULE audit_event_no_delete AS
    ON DELETE TO audit_event DO INSTEAD NOTHING;

-- One email per tenant — but only over the rows that have one. A student
-- created by a guardian has no address until the guardian sets one, and NULLs
-- do not collide, so a plain unique constraint would be wrong in the other
-- direction: it would allow one address twice as easily as it forbids two
-- blanks.
CREATE UNIQUE INDEX "uq_user_org_email"
    ON "user_account" ("organization_id", "email")
    WHERE email IS NOT NULL;

-- A role is held once per region: a regional administrator responsible for two
-- regions is one role held twice with different bounds. `uq_user_role` above
-- cannot enforce the unbounded case, because its `region_id` is NULL and NULLs
-- never collide.
CREATE UNIQUE INDEX "uq_user_role_unbounded"
    ON "user_role" ("user_id", "role")
    WHERE region_id IS NULL;
