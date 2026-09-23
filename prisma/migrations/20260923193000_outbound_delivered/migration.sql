-- A delivered outbound row is not sent again. Null means it is still waiting.
ALTER TABLE "outbound_change" ADD COLUMN "delivered_at" TIMESTAMPTZ(6);

CREATE INDEX "ix_outbound_change_delivered" ON "outbound_change"("delivered_at");
