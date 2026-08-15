-- AIscentra — correct pipeline_metrics column comments to match the
-- real, honest metrics contract (independent review of PR #50/#51)
--
-- REAL BUG this closes: the items_retried column comment (added in
-- 20260811130000_extend_pipeline_metrics_rejected_retried.sql) stated
-- that retried observations are "intentionally excluded from
-- items_attempted/items_succeeded/items_rejected/items_failed" --
-- this directly CONTRADICTS the actual, current contract this project
-- enforces in application code (route.ts's own BatchStats accounting,
-- verified across every real error-handling branch):
--
--     items_attempted = items_succeeded + items_rejected +
--                        items_failed + items_retried
--
-- `items_retried` IS one of the four addends that together make up
-- `items_attempted` -- it was never excluded from it. Every observation
-- genuinely extracted from the queue and passed into the processing
-- workflow counts toward attempted exactly once, regardless of which
-- of the four terminal categories it ultimately resolves to this
-- cycle (succeeded, rejected, failed, or retried-for-a-later-attempt).
--
-- This migration only corrects the column COMMENTS (documentation) to
-- match the real, already-correct application-level contract -- it
-- does not alter any column, type, default, or data. No backfill is
-- needed: existing rows' numeric values are unaffected by a comment
-- correction.

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

COMMENT ON COLUMN public.pipeline_metrics.items_retried IS
  'Count of observations requeued for a later attempt this cycle
   (HTTP 429 rate limit, AI_DEADLINE_EXCEEDED, AI_TOKEN_BUDGET_EXCEEDED,
   AI_REQUEST_TOO_LARGE, a genuine Source-read failure, or a genuine
   result-write failure) -- one of the four terminal categories that
   together sum to items_attempted (see items_attempted''s own comment
   for the real, enforced invariant). A requeue attempt that ALSO
   fails to write (the observation could not actually be put back in
   the queue) is counted toward items_failed instead, never
   items_retried -- the requeue did not genuinely happen.';

COMMENT ON COLUMN public.pipeline_metrics.items_succeeded IS
  'Count of observations this cycle that reached a genuine, positive
   Signal Engine outcome (signal_created, weak_signal_created, or
   corroborated_existing_signal) AND whose result was successfully
   persisted. One of the four terminal categories summing to
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
