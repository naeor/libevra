-- Agreement acceptance and major-announcement acknowledgement.
--
-- Additive only: two new tables, no changes to existing columns or data. Older application
-- versions ignore them, so applying the migration does not change any existing behaviour.

CREATE TABLE "agreement_acceptances" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_id" VARCHAR(64) NOT NULL,
    "document_version" VARCHAR(64) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "action" VARCHAR(16) NOT NULL DEFAULT 'accept',
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agreement_acceptances_user_id_document_id_idx"
    ON "agreement_acceptances"("user_id", "document_id");
CREATE UNIQUE INDEX "agreement_acceptances_user_id_document_id_document_version_key"
    ON "agreement_acceptances"("user_id", "document_id", "document_version");
ALTER TABLE "agreement_acceptances"
    ADD CONSTRAINT "agreement_acceptances_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agreement_acceptances"
    ADD CONSTRAINT "agreement_acceptances_action_known"
    CHECK ("action" IN ('accept'));

CREATE TABLE "major_announcement_acknowledgements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "announcement_id" VARCHAR(64) NOT NULL,
    "announcement_version" VARCHAR(64) NOT NULL,
    "action" VARCHAR(16) NOT NULL DEFAULT 'acknowledged',
    "acknowledged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "major_announcement_acknowledgements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "major_announcement_acknowledgements_user_id_idx"
    ON "major_announcement_acknowledgements"("user_id");
CREATE UNIQUE INDEX "major_announcement_acknowledgements_user_id_announcement_id_key"
    ON "major_announcement_acknowledgements"("user_id", "announcement_id");
ALTER TABLE "major_announcement_acknowledgements"
    ADD CONSTRAINT "major_announcement_acknowledgements_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "major_announcement_acknowledgements"
    ADD CONSTRAINT "major_announcement_acknowledgements_action_known"
    CHECK ("action" IN ('acknowledged', 'opened_details', 'dismissed'));
