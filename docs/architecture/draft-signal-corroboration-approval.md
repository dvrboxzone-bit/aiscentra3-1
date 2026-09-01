# DRAFT Signal corroboration and approval

This checkpoint adds one protected, explicit operation for a `DRAFT` / `PENDING`
Signal already classified as `SIGNAL`. It links one existing verified observation,
requires an explicit append-only provenance assessment for every evidence
observation, two distinct confirmed origin owners, and distinct source roots. It
then atomically transitions the Signal to `APPROVED` / `ACTIVE` under the existing
quality thresholds.

The corroboration operation is service-role-only and has no HTTP route, scheduler,
provider call, or automatic invocation. It remains separate from the normal
Durable SIS `PRIMARY_CONFIRMED` path: primary issuer/preprint evidence does not
earn independence credit, while corroboration still requires two explicitly
assessed independent owners. Both the corroboration audit and quality decision are
append-only. Origin ownership is never inferred from hostname, title, or semantic
similarity. Missing or `UNKNOWN` assessments, `SAME_ORIGIN` evidence, identical
origin owners, and corroborating evidence that is not `INDEPENDENTLY_VERIFIED`
all fail closed. Source roots remain an additional guard: two source rows owned by
the same root still count once, but different hosts alone never prove independence.

`WEAK` and classifier `ARCHIVE` outcomes remain non-public and cannot use this
operation. Any future WEAK reclassification requires a separate reviewed contract;
it is intentionally outside this change.
