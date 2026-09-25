-- A credit balance on the person, and a local copy of messages that are not sent.

ALTER TABLE "user_account" ADD COLUMN "credit_balance" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "captured_message" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "session_id" BIGINT,
    "user_id" BIGINT NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "offset_minutes" INTEGER NOT NULL DEFAULT 0,
    "address" VARCHAR(320) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "retired_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "captured_message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_captured_message_org" ON "captured_message"("organization_id", "created_at");
CREATE INDEX "ix_captured_message_session" ON "captured_message"("session_id");

-- One open copy of a notice. A retired row stays, so a reschedule can write
-- the next one without colliding with the one it replaced.
CREATE UNIQUE INDEX "uq_captured_message_open"
    ON "captured_message"("session_id", "user_id", "channel", "kind", "offset_minutes")
    WHERE "retired_at" IS NULL;

ALTER TABLE "captured_message"
    ADD CONSTRAINT "captured_message_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "captured_message"
    ADD CONSTRAINT "captured_message_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session_occurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "captured_message"
    ADD CONSTRAINT "captured_message_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
