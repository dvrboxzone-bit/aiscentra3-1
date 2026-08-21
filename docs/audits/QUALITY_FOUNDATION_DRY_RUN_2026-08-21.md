# Quality Foundation Phase 1 — dry-run audit

Snapshot time: 2026-08-21 (Asia/Krasnoyarsk)

Source: production Supabase, aggregate/read-only queries only

Rule version: `quality-foundation-v1`

No migrations, cron jobs, URL backfills, batch jobs, agents or data writes were run.

## Planned backfill result

| State         |   Count |
| ------------- | ------: |
| `APPROVED`    |       0 |
| `PENDING`     |     136 |
| `QUARANTINED` |     147 |
| **Total**     | **283** |

## Reason codes

| Reason code               | Count |
| ------------------------- | ----: |
| `AWAITING_QUALITY_REVIEW` |   136 |
| `LEGACY_STATUS_WEAK`      |   147 |
| `LEGACY_STATUS_DORMANT`   |     0 |
| `LEGACY_STATUS_EXPIRED`   |     0 |
| `LEGACY_STATUS_REJECTED`  |     0 |

Production lifecycle distribution at the snapshot: `ACTIVE=134`,
`PROMOTED=2`, `WEAK=147`. The existing application-level public gate
(`ACTIVE/PROMOTED` plus `has_verified_source=true`) returned 133 Signals.

Phase 1 does not add `quality_state` to public Signal queries or policies, so
this existing 133-Signal feed contract remains unchanged. New strong Signals
are stored as internal `DRAFT/PENDING`; no automatic approvals exist.
