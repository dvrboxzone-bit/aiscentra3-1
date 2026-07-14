# AIscentra — Technical Architecture Reference

## What AIscentra Is

AIscentra is an **Intelligence Observatory** — not a news website, not a blog, not a directory.
It transforms fragmented AI ecosystem activity into structured, scored intelligence.

The central entity is a **Signal**: a validated, scored indicator of meaningful change.

## Repository Structure

```
aiscentra/
├── src/
│   ├── app/                  # Next.js App Router — pages and layouts
│   │   ├── (observatory)/    # Public Observatory pages (home, signals, events)
│   │   ├── signals/[slug]/   # Signal detail pages
│   │   ├── events/[slug]/    # Event detail pages
│   │   ├── reports/[slug]/   # Report pages
│   │   ├── assistant/        # Observatory Assistant
│   │   ├── admin/            # Admin interface (auth-protected)
│   │   └── about/            # About the Observatory
│   │
│   ├── components/           # Shared UI components
│   │   ├── ui/               # Primitive UI elements (button, badge, card)
│   │   ├── layout/           # Navigation, footer, page shells
│   │   ├── signals/          # Signal-specific display components
│   │   ├── events/           # Event-specific display components
│   │   ├── reports/          # Report display components
│   │   └── observatory/      # Observatory dashboard components
│   │
│   ├── modules/              # Domain modules — business logic by domain
│   │   ├── signals/          # Signal queries, transformations, scoring
│   │   ├── events/           # Event queries and enrichment
│   │   ├── reports/          # Report generation and retrieval
│   │   ├── entities/         # Entity management and relationship queries
│   │   ├── knowledge/        # Knowledge asset operations
│   │   └── observations/     # Observation pipeline operations
│   │
│   ├── lib/                  # Infrastructure and utilities
│   │   ├── supabase/         # Supabase clients (browser, server, admin, middleware)
│   │   ├── openrouter/       # OpenRouter AI client
│   │   └── utils/            # cn(), formatters, validators
│   │
│   ├── types/                # TypeScript type definitions
│   │   └── database.ts       # All database types — single source of truth
│   │
│   └── config/
│       └── env.ts            # Validated environment variables
│
├── supabase/
│   ├── migrations/           # SQL migrations — append-only
│   └── functions/            # Edge Functions for async pipeline
│
└── docs/                     # Engineering documentation
```

## Technology Decisions

| Decision | Choice | Reason |
|---|---|---|
| Framework | Next.js 15, App Router | SSR for SEO, signals/events must be indexable |
| Language | TypeScript (strict) | Intelligence system must be fully typed |
| Database | Supabase | Free tier viable for MVP, scales to Pro without schema change |
| AI | OpenRouter | Model-agnostic, budget-controlled, single integration point |
| Styling | Tailwind CSS | Design Foundation color system maps directly to config |
| Hosting | Vercel | Zero-config Next.js deployment |

## Intelligence Pipeline

```
External Sources
      ↓
Observation Layer (Edge Function, every 4h)
      ↓
Signal Engine     (Edge Function, chained after collection)
      ↓
Event Generator   (Edge Function, every 4h)
      ↓
Content Agent     (Edge Function, daily)
      ↓
Knowledge Agent   (Edge Function, daily)
      ↓
User / Assistant
```

## Build Order (current stage)

See `Build Order v1.0` in project documents.

- [x] Stage 0 — Blueprint (complete — all strategic documents)
- [ ] Stage 1 — Design System Foundation ← **current**
- [ ] Stage 2 — Supabase Foundation
- [ ] Stage 3 — Database Schema
- ...

## Key Rules

1. **No code without a document reference.** Every implementation decision traces to an approved document.
2. **Types first, then migrations.** Change `src/types/database.ts` before writing SQL.
3. **Server env never reaches the browser.** `serverEnv` is server-only.
4. **The Observer pattern.** Four intelligence layers: Factual → Interpretive → Hypothetical → Forecast.
5. **Signals are immutable after activation.** Updates go in `metadata.audit_log`.
