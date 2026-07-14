# AIscentra Database Migrations

## Naming Convention
```
YYYYMMDDHHMMSS_description.sql
```

Example: `20250115000001_create_sources_table.sql`

## Rules

1. **Never edit a committed migration.** Create a new migration to fix issues.
2. **Every migration must be reversible** — include a rollback comment even if not automated.
3. **Schema changes follow the type system.** Update `src/types/database.ts` first, then write the migration.
4. **RLS policies are part of the migration** — not a separate step. A table without RLS is a security gap.

## Stage 3 Migrations (Database Schema)

Migrations will be created for these tables in order:
1. `sources` — Observation source registry
2. `observations` — Raw collected data (content: first 3000 chars stored)
3. `signals` — Scored intelligence objects
4. `events` — Promoted signals enriched with interpretation
5. `reports` — Generated intelligence reports
6. `entities` — Ecosystem entity registry
7. `entity_relationships` — Entity connection graph
8. `knowledge_assets` — Accumulated structured knowledge
9. `admin_users` — Admin session management

## Reference Documents
- System Blueprint v1.0 — database architecture
- Signal Scoring Specification v1.0 — signals table extended fields
- Readiness Assessment v1.0 — Blocker B-01 (content storage), Blocker B-02 (RLS)
