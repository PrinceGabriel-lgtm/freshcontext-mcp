-- PROPOSAL — application intake. Subject to review before finalization.
-- Reviewed and NOT yet applied. Prince commits the file; execution is a separate gated step.
--
-- Context: /apply prepares a mailto draft in the visitor's browser and nothing is
-- persisted. The reference the page mints is the same identifier the service kits carry
-- as application_ref and ops/commercial/generate-pack.mjs consumes. This table is the
-- missing first link in that chain.
--
-- DO NOT APPLY BEFORE privacy.html IS UPDATED, and do not enable the public route on the
-- strength of CORS. CORS is a browser control, not access control: an unmounted-but-
-- reachable anonymous writer is still a public writer. The route ships unmounted and
-- feature-disabled; collection begins only after the privacy notice describes it.

-- ─── DESIGN QUESTION (a): retention — how is "90 days unless converted" enforced? ───
--
-- DECISION: store purge_after as a STORED ISO-8601 date, written at INSERT.
--
-- Reason 1 — a retention promise computed on read is not a retention control. If the
--   window lives only in application code, changing a constant silently rewrites the
--   promise made to every person already in the table. A stored per-row date is the
--   commitment actually made to that applicant, at the time they applied.
--
-- Reason 2 — conversion extends nothing automatically. purge_after is cleared to NULL
--   only by an explicit operator transition. NULL means "retained because this became a
--   live matter", not "retained because nobody looked".
--
-- Reason 3 — the purge is enforced, not aspirational. purgeExpiredApplications() runs on
--   the existing 6-hourly scheduled handler and is proven by test: an expired unconverted
--   row is deleted, a NULL row survives. The privacy notice may not claim the 90-day
--   control until that job is running in the same release as collection.

-- ─── DESIGN QUESTION (b): which fields are stored at all? ────────────────────
--
-- DECISION: store the qualification answers; never the raw email body.
--
-- The fourteen fields are not equivalent in sensitivity. Identity (name, email, company,
--   role) identifies a named individual at a named employer. The free-text answers
--   (workflow, stack, failure, acceptance) describe that employer's internal systems and
--   how they break. The second category is the more dangerous, and it is also the whole
--   reason the record is worth keeping — an application with the qualification stripped
--   out cannot be qualified. So it is stored, and the mitigations sit elsewhere: a stated
--   retention window, no logging of field values, and existing site copy telling
--   applicants not to send secrets or production data through this channel.
--
-- NOT stored: IP address, user agent, any request header. A prospective client is not a
--   caller to be profiled, and Cloudflare's own request logs already cover abuse
--   investigation without this table duplicating it. The IP is used transiently as a
--   rate-limit key and never reaches D1.

-- ─── DESIGN QUESTION (c): trust the browser-minted reference? ────────────────
--
-- DECISION: NO. The server mints its own; the client's is stored separately.
--
-- The page mints FC-APP-YYYYMMDD-XXXXXX before anything is sent and an existing Playwright
--   test asserts that format. That reference is already in the visitor's email draft, so
--   discarding it breaks correspondence matching. But a client-supplied identifier is
--   attacker-controlled: it can collide with an existing row, impersonate a reference
--   already quoted to a real prospect, or carry a payload downstream into every document
--   the pack generator produces.
--
-- Both are kept. reference is server-minted and is the PK. client_reference is whatever
--   the browser claimed, format-validated then stored verbatim, never trusted, never used
--   as a lookup key for a privileged operation. A mismatch is a signal to look at.

-- ─── DESIGN QUESTION (d): state vocabulary — one machine or two? ─────────────
--
-- DECISION: ops/commercial/README.md remains canonical. This table stores THAT vocabulary.
--
-- A second workflow language for the same matter is a defect, not a feature. The funnel
--   stages (received / qualified / service_order / signed / invoiced / paid / delivery /
--   accepted / closed) are a PROJECTION for analytics, derived in code by
--   funnelStageFor(status) in applicationIntake.ts. They are deliberately NOT a column.
--
-- This follows the precedent set in 0001 for verification_status: a value derivable from
--   data already in the row is computed on read, never stored. Storing the funnel stage
--   would create a second source of truth that can disagree with status, and the
--   disagreement would be silent.
--
-- Operational distinctions the funnel cannot express are preserved precisely because the
--   operational vocabulary stays canonical: SCOPE_APPROVED is not CONTRACT_SENT,
--   READY_TO_START is not IN_PROGRESS, ACCEPTANCE_PENDING is not ACCEPTED, and
--   CLARIFICATION_REQUIRED / PAUSED / CANCELLED / DISPUTED have no funnel equivalent at all.
--
-- ONE state is added: INVOICE_ISSUED. This is not a preference. generate-pack.mjs already
--   mints FC-INV-<date>-<suffix>-01 and writes it to the manifest, but the manifest's only
--   status is DRAFT_NOT_EXECUTED and no state records the transition from draft to formally
--   issued. DEPOSIT_PENDING implies an invoice exists without evidencing its issuance. So
--   issuance is currently unprovable, which is exactly the condition under which a new
--   state is warranted. It sits between CONTRACT_SENT/SIGNED and DEPOSIT_PENDING.

-- ─── DESIGN QUESTION (e): indexes ────────────────────────────────────────────
--
-- The purge path queries by purge_after. The operator discovery path lists by status and
--   received_at. Correspondence lookup is by client_reference. Four indexes; reference is
--   the PK and is indexed by SQLite already.

-- ─── TABLE ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS commercial_applications (
  reference TEXT PRIMARY KEY,
  -- ^ Server-minted, FC-APP-YYYYMMDD-XXXXXX. The identifier of record, and the value
  --   that flows into service-kits application_ref and generate-pack.mjs --application.

  client_reference TEXT,
  -- ^ The reference the browser minted. Format-validated, stored verbatim, never trusted.
  --   Nullable: a submission with scripting disabled may not supply one.

  service TEXT NOT NULL,
  -- ^ One of assessment | single-workflow | private-multi | build-to-spec. Validated at
  --   the endpoint against the catalog, not by a CHECK constraint: the catalog is data
  --   that changes without a migration and a stale constraint would reject a valid service.

  company TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_role TEXT NOT NULL,
  -- ^ Identity block. Personal data. Subject to purge_after.

  workflow TEXT NOT NULL,
  stack TEXT NOT NULL,
  failure_mode TEXT NOT NULL,
  acceptance TEXT NOT NULL,
  -- ^ Qualification block. Describes the applicant's systems and how they fail.
  --   Commercially sensitive: never logged, never echoed in a response body.

  timeline TEXT NOT NULL,
  environment TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  authority TEXT NOT NULL,
  -- ^ Constrained selects, stored as text for the same reason as service: the option list
  --   is page copy, not a database contract.

  acknowledged INTEGER NOT NULL,
  -- ^ 1 when the applicant ticked the non-binding acknowledgement. The page already
  --   refuses to prepare an application without it; this records that it happened.

  status TEXT NOT NULL DEFAULT 'APPLICATION_RECEIVED',
  -- ^ Canonical operational vocabulary from ops/commercial/README.md, plus INVOICE_ISSUED.
  --   See design question (d). Funnel stage is DERIVED from this, never stored.

  received_at TEXT NOT NULL,
  -- ^ ISO-8601, server clock at INSERT. Never a client-supplied timestamp.

  purge_after TEXT,
  -- ^ ISO-8601, received_at + 90 days, written at INSERT. NULL means retained as a live
  --   matter by explicit operator transition. See design question (a).

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

-- Retention sweep: rows whose stated window has elapsed.
CREATE INDEX IF NOT EXISTS idx_commercial_applications_purge_after
  ON commercial_applications (purge_after);

-- Operator discovery: unreviewed applications, newest first. This index is what makes the
-- one-business-day review cadence cheap enough to actually keep.
CREATE INDEX IF NOT EXISTS idx_commercial_applications_status_received
  ON commercial_applications (status, received_at);

-- Correspondence lookup by the reference quoted in the applicant's own email.
CREATE INDEX IF NOT EXISTS idx_commercial_applications_client_reference
  ON commercial_applications (client_reference);

-- Chronological listing for review.
CREATE INDEX IF NOT EXISTS idx_commercial_applications_received_at
  ON commercial_applications (received_at);
