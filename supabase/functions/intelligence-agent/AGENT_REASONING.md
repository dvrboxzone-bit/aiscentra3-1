# Agent Reasoning

**File:** `reasoning-engine.ts`

## Principle

The `ReasoningEngine` interface (in `interfaces.ts`) defines a single method:

```typescript
reason(input: ReasoningInput): Promise<ReasoningResult>
```

`MockReasoningEngine` is the **only** implementation currently in the
codebase. It performs **zero LLM calls** — this is an explicit constraint of
Phase 11 (Agent Runtime Implementation), which prohibits any modification to
or dependency on Signal Engine components, including its LLM integration.

## What MockReasoningEngine Produces

Given the `AgentContext` assembled by the Context Loader, it deterministically
generates a `ReasoningResult` with claims tagged by type:

### FACT claims
One per signal present in context (up to 5), each directly evidenced by that
signal's ID. Confidence fixed at 9 — these are direct database facts, not
inferences.

### INFERENCE claims
If multiple signals share the same category, a single INFERENCE claim notes
this as a *possible* pattern — explicitly hedged ("MAY indicate... requires
more observations to confirm"). Confidence fixed at 5, reflecting genuine
uncertainty about whether shared category is coincidental or meaningful.

### GAP claims
One per entry in `context.gaps` (produced by the Context Loader), plus an
additional gap claim if BOTH observations and signals are empty. Confidence
0 — gaps are not evidence, they are acknowledgments of missing evidence.

## Claim Types — Carried Through to Final Output

The `ClaimType` enum (`FACT | INFERENCE | GAP | HYPOTHESIS`) is designed to
survive all the way to the eventual user-facing output, mirroring the
Observatory Assistant's own epistemic tagging system
(`[SIGNAL] / [INFERENCE] / [GAP]`, documented in the Assistant's system
prompt). This is intentional architectural consistency — the Agent and the
Assistant should never present inference as fact, and both should make gaps
visible rather than paper over them with confident-sounding prose.

**`HYPOTHESIS` is part of the type contract but not currently produced.**
`MockReasoningEngine` — the only `ReasoningEngine` implementation that
exists today — generates only `FACT`, `INFERENCE`, and `GAP` claims. No code
path in the current codebase constructs a claim with `type: 'HYPOTHESIS'`.
The value remains in the `ClaimType` union for forward compatibility: a
future reasoning engine (e.g. one capable of genuine speculative synthesis
across weakly-correlated signals) may need to emit `HYPOTHESIS`-tagged
claims, and the type contract already accommodates that without requiring a
change to `types.ts`, `execution.ts`, or any consumer of `ReasoningResult`.

## Confidence Aggregation

`ReasoningResult.confidence` is the arithmetic mean of all claims' individual
confidence values, rounded. A result with several FACT claims (confidence 9)
and one GAP claim (confidence 0) will show meaningfully reduced overall
confidence — this is deliberate: acknowledging what is missing should pull
down the aggregate, not be diluted away by unrelated high-confidence facts.

## What a Real ReasoningEngine Will Do Differently

A future `GroqReasoningEngine` (or similar) implementing the same
`ReasoningEngine` interface will:
- Actually synthesize claims from context (not just enumerate signals)
- Identify genuine cross-signal patterns, contradictions, and second-order
  effects — capabilities `MockReasoningEngine` does not attempt
- Produce natural-language claim statements grounded in the evidence, rather
  than templated strings
- Still be required to tag every claim's type and confidence, and to surface
  gaps explicitly — this contract does not change

**No change to `execution.ts`, `runtime.ts`, or any other module is required**
to swap `MockReasoningEngine` for a real implementation — only a new class
satisfying the `ReasoningEngine` interface, and updated wiring wherever the
runtime is constructed (currently `index.ts`'s `buildMockRuntime()`).

## Explicit Constraint Reminder

Per Phase 11 instructions: **no LLM calls are permitted in this phase.** This
document describes `MockReasoningEngine`'s behavior as implemented — it
performs no network calls, no Groq invocation, and has no dependency on
`src/lib/ai/*`. This is verified by code inspection — `reasoning-engine.ts`
imports only from `./interfaces` and `./types`.
