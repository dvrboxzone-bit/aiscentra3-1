-- AIscentra — extend pipeline_metrics with items_rejected/items_retried
--
-- Real production incident this closes: pipeline_metrics recorded
-- itemsAttempted/itemsSucceeded/itemsFailed only, with itemsFailed
-- conflating three genuinely different populations -- legitimate
-- rejection decisions (archived_prefilter, rejected_duplicate, etc.),
-- items requeued for a later retry (429/deadline/budget), and genuine
-- processing errors. The application-level fix (classifyOutcome,
-- route.ts) now tracks these as real, mutually-exclusive categories;
-- this migration adds the two missing columns so they can be
-- persisted and queried, matching the decision log's own real
-- distinctions instead of collapsing them into one misleading
-- "failed" count.
--
-- Idempotent (IF NOT EXISTS), additive only, matches the same pattern
-- as every other pipeline_metrics migration in this project.

ALTER TABLE public.pipeline_metrics
  ADD COLUMN IF NOT EXISTS items_rejected INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_retried INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pipeline_metrics.items_rejected IS
  'Count of observations this cycle resolved with a legitimate,
   intentional REJECTION or ARCHIVAL decision (archived_prefilter,
   rejected_duplicate, rejected_marketing, rejected_hard_rule,
   rejected_low_sis, rejected_validation, rejected_low_score,
   archived_observation) -- a correct Signal Engine outcome, distinct
   from items_failed (a genuine processing error) and distinct from
   items_succeeded (signal_created, weak_signal_created,
   corroborated_existing_signal).';

COMMENT ON COLUMN public.pipeline_metrics.items_retried IS
  'Count of observations requeued for a later attempt this cycle
   (HTTP 429 rate limit, AI_DEADLINE_EXCEEDED, or
   AI_TOKEN_BUDGET_EXCEEDED) -- not yet resolved, so intentionally
   excluded from items_attempted/items_succeeded/items_rejected/
   items_failed, which together represent only FINAL decisions made
   this cycle.';
