# DRAFT Signal corroboration and approval

This checkpoint adds one protected, explicit operation for a `DRAFT` / `PENDING`
Signal already classified as `SIGNAL`. It links one existing verified observation,
requires at least two known canonical provenance roots, and atomically transitions
the Signal to `APPROVED` / `ACTIVE` under the existing quality thresholds.

The operation is service-role-only and has no HTTP route, scheduler, provider call,
or automatic invocation. Both the corroboration audit and quality decision are
append-only. Unknown provenance never counts as independence, and two source rows
owned by the same provenance root count once.

`WEAK` and classifier `ARCHIVE` outcomes remain non-public and cannot use this
operation. Any future WEAK reclassification requires a separate reviewed contract;
it is intentionally outside this change.
