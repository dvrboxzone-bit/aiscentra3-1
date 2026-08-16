-- AIscentra — extend pipeline_metrics with items_rejected/items_retried
--
-- Real production incident this closes: pipeline_metrics recorded
-- itemsAttempted/itemsSucceeded/itemsFailed only, with itemsFailed
-- conflating three genuinely different populations -- legitimate
-- rejection decisions (archived_prefilter, rejected_duplicate, etc.),
-- items requeued for a later retry (429/deadline/budget/request-too-
-- large/source-read failure/result-write failure), and genuine
-- processing errors. The application-level fix (classifyOutcome,
-- route.ts) now tracks these as real, mutually-exclusive categories;
-- this migration adds the two missing columns so they can be
-- persisted and queried, matching the decision log's own real
-- distinctions instead of collapsing them into one misleading
-- "failed" count.
--
-- HONEST METRICS CONTRACT (single, enforced invariant across every
-- error-handling branch in route.ts):
--
--     items_attempted = items_succeeded + items_rejected +
--                        items_failed + items_retried
--
-- items_retried IS one of the four addends that together make up
-- items_attempted -- it is never excluded from it. Every observation
-- genuinely extracted from the queue and passed into the processing
-- workflow counts toward attempted exactly once this cycle, regardless
-- of which of the four terminal categories it ultimately resolves to
-- (succeeded, rejected, failed, or retried-for-a-later-attempt). A
-- genuine queue-read failure (the page fetch itself failing, before
-- any observation was ever extracted) contributes 0 to items_attempted
-- for that cycle -- there was nothing to attempt.
--
-- Idempotent (IF NOT EXISTS), additive only, matches the same pattern
-- as every other pipeline_metrics migration in this project.

ALTER TABLE public.pipeline_metrics
  ADD COLUMN IF NOT EXISTS items_rejected INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_retried INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.pipeline_metrics.items_attempted IS
  'Every observation genuinely extracted from the queue and passed
   into the processing workflow this cycle -- including one whose
   final resolution was a controlled requeue (items_retried), not only
   ones that reached a final succeeded/rejected/failed outcome. Real,
   enforced invariant: items_attempted = items_succeeded +
   items_rejected + items_failed + items_retried. A genuine queue-read
   failure (the page fetch itself failing, before any observation was
   ever extracted) contributes 0 to items_attempted for that cycle --
   there was nothing to attempt.';

COMMENT ON COLUMN public.pipeline_metrics.items_succeeded IS
  'Count of observations this cycle that reached a genuine, positive
   Signal Engine outcome (signal_created, weak_signal_created, or
   corroborated_existing_signal) AND whose result was successfully
   persisted. One of the four terminal categories summing to
   items_attempted (see items_attempted''s own comment for the real,
   enforced invariant).';

COMMENT ON COLUMN public.pipeline_metrics.items_rejected IS
  'Count of observations this cycle resolved with a legitimate,
   intentional REJECTION or ARCHIVAL decision (archived_prefilter,
   rejected_duplicate, rejected_marketing, rejected_hard_rule,
   rejected_low_sis, rejected_validation, rejected_low_score,
   archived_observation) -- a correct Signal Engine outcome, distinct
   from items_failed (a genuine processing error) and distinct from
   items_succeeded. One of the four terminal categories summing to
   items_attempted.';

COMMENT ON COLUMN public.pipeline_metrics.items_failed IS
  'Count of observations this cycle that ended in a genuine,
   unresolved permanent failure -- either a real processing error
   (outcome:''error'' from the Signal Engine) or a requeue attempt
   whose own write also failed (the observation could not be put back
   in the queue, so it is not counted as retried). One of the four
   terminal categories summing to items_attempted. Distinct from
   items_rejected (a legitimate, intentional decision, not a
   failure).';

COMMENT ON COLUMN public.pipeline_metrics.items_retried IS
  'Count of observations requeued for a later attempt this cycle
   (HTTP 429 rate limit, AI_DEADLINE_EXCEEDED, AI_TOKEN_BUDGET_EXCEEDED,
   AI_REQUEST_TOO_LARGE, a genuine Source-read failure, or a genuine
   result-write failure). REAL, ENFORCED INVARIANT: items_retried IS
   one of the four addends summing to items_attempted -- it is NEVER
   excluded from it (see items_attempted''s own comment). A requeue
   attempt that ALSO fails to write (the observation could not
   actually be put back in the queue) is counted toward items_failed
   instead, never items_retried -- the requeue did not genuinely
   happen.';
