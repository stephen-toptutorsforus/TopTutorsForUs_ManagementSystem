-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('previewed', 'committed');

-- CreateEnum
CREATE TYPE "import_kind" AS ENUM ('person', 'session', 'series');

-- AlterEnum
ALTER TYPE "audit_category" ADD VALUE 'import';

-- CreateTable
CREATE TABLE "import_batch" (
    "id" BIGSERIAL NOT NULL,
    "ref" VARCHAR(24) NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "created_by_id" BIGINT,
    "status" "import_status" NOT NULL,
    "people_digest" VARCHAR(64),
    "sessions_digest" VARCHAR(64),
    "series_digest" VARCHAR(64),
    "source_people" TEXT,
    "source_sessions" TEXT,
    "source_series" TEXT,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMPTZ(6),

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_record" (
    "id" BIGSERIAL NOT NULL,
    "organization_id" BIGINT NOT NULL,
    "batch_id" BIGINT NOT NULL,
    "kind" "import_kind" NOT NULL,
    "source_key" VARCHAR(64) NOT NULL,
    "entity_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_batch_ref_key" ON "import_batch"("ref");

-- CreateIndex
CREATE INDEX "ix_import_batch_org_created" ON "import_batch"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "import_batch_created_by_id_idx" ON "import_batch"("created_by_id");

-- CreateIndex
CREATE INDEX "import_record_batch_id_idx" ON "import_record"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_record" ON "import_record"("organization_id", "kind", "source_key");

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_record" ADD CONSTRAINT "import_record_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_record" ADD CONSTRAINT "import_record_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
