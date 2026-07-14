/**
 * AIscentra — Supabase Database Type Wrapper
 *
 * This file is the bridge between our domain types (src/types/database.ts)
 * and Supabase's generated types.
 *
 * To regenerate after schema changes:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/lib/supabase/generated.ts
 * Then update the Database type below to import from generated.ts.
 *
 * For now, this is a structural placeholder that will be replaced
 * when the Supabase project is connected (Stage 2).
 */

// Temporary type — replaced by generated Supabase types in Stage 2
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Database = {}
