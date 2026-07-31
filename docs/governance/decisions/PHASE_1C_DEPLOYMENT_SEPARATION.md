# PHASE 1C — DEPLOYMENT SEPARATION: DECISION RECORD

**Status:** Design approved for staged implementation; Phase 1C-B1
implemented and independently verified; Phase 1C-B2 not started. This
document does not authorize further implementation by itself.
**Design baseline:** `main@bf4d507319c20160b742fc2de5d0398b5c047360`
**Phase 1C-B1 closeout evidence baseline:** `main@0bf8fe15604808a7ca94b532689f6b209804aed9`
**Date:** 31 July 2026
**Related:** `docs/governance/AISCENTRA_REPAIR_ROADMAP.md` Phase 1C

This document does not authorize any code, Vercel, GitHub Actions, or
production change. It records current confirmed behavior, the actual
platform configuration established via primary artifacts where
available, a comparison of at least three architectural options, a
recommendation, and open questions requiring an explicit owner decision
before Phase 1C implementation can be scoped as a separate task.

---

## 1. Current confirmed behavior

- Merging a pull request into `main` on GitHub automatically triggers a
  Vercel production deployment, targeting the custom domains
  `aiscentra.com` and `www.aiscentra.com`. This was directly observed
  and independently confirmed for PR #3, PR #4, and PR #5: in each case,
  a new Vercel deployment with `target: "production"` and
  `githubCommitSha` exactly matching the GitHub merge commit SHA
  appeared automatically within seconds of the merge, with no manual
  deployment action taken.
- The `Protect main` repository ruleset now structurally requires a
  pull request and the configured Quality Gate before `main` can be
  updated.
- The ruleset requires zero human approving reviews. The owner's
  explicit merge authorization therefore remains a governance
  requirement enforced by the operating protocol, not by a
  required-review-count setting.
- A separate structural production-deployment approval gate still does
  not exist: merging to `main` continues to trigger an automatic Vercel
  production deployment. **This remains true after Phase 1C-B1** — B1
  closed the exact-SHA CI gap described below, but did not disable
  automatic deployment; that remains Phase 1C-B2's scope.
- **Phase 1C-B1 closeout (new, this update):** the exact-main-SHA
  Quality Gate gap described in the original design below (Section 5)
  is now closed and independently verified. PR #8 (merging
  `ci/exact-main-sha-quality-gate` into `main`) added a `push: branches:
[main]` trigger alongside the existing `pull_request` trigger, with an
  event-specific, fail-closed format-check split and a diagnostic step
  proving `git.head == github.sha` on every run. PR #8 merged as commit
  `0bf8fe15604808a7ca94b532689f6b209804aed9`; the automatic
  `push`-triggered run (`30629372155`, job `91151923416`) confirmed
  `event=push`, `ref=refs/heads/main`, `head_sha` equal to the merge SHA,
  all steps `success`, 95/95 tests, and a production build on Next.js
  `16.2.12`. The automatic production deployment triggered by the same
  merge (`dpl_A9wVLvHYqrvwhHE2NJANxatCmi9U`) reached `READY` with
  `githubCommitSha` equal to the merge SHA. Full detail in
  `docs/governance/AISCENTRA_REPAIR_ROADMAP.md` Phase 1C-B1.

## 2. Actual platform configuration (established via primary artifacts)

### 2.1 Vercel — confirmed via `Vercel:get_project` / `Vercel:get_project_deployment_protection` (live API calls, this task)

| Setting                              | Value                                                                                                                                                                                        | Source                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Project ID                           | `prj_CSXbFWdA5q0xM5F0oQ57eKn1W3zF`                                                                                                                                                           | `get_project`                       |
| Team ID                              | `team_kcxAeWtnmoE4vJPkVHy2vbjT`                                                                                                                                                              | `get_project`                       |
| Framework                            | `nextjs`                                                                                                                                                                                     | `get_project`                       |
| Production domains                   | `aiscentra.com`, `www.aiscentra.com`, `aiscentra3-1.vercel.app`, `aiscentra3-1-welvers-projects.vercel.app`, `aiscentra3-1-git-main-welvers-projects.vercel.app`                             | `get_project`                       |
| Latest deployment at time of writing | `dpl_DNUoRmQf3kj68UPS4Z4FoQyEVsZG`, `READY`, `target: production`                                                                                                                            | `get_project`                       |
| SSO / Vercel Authentication          | **Enabled**, `deploymentType: all_except_custom_domains` — i.e. all Preview/branch URLs require Vercel-account auth to view; the custom domain (`aiscentra.com`) remains publicly accessible | `get_project_deployment_protection` |
| Password protection                  | Disabled                                                                                                                                                                                     | `get_project_deployment_protection` |
| Trusted IPs                          | Disabled                                                                                                                                                                                     | `get_project_deployment_protection` |

**Not independently confirmed via available MCP tools in this task**
(disclosed honestly, not assumed):

- The explicit "Production Branch" project setting value (expected to be
  `main` based on observed behavior, but the specific project-settings
  field was not returned by the `get_project` tool's response schema).
- The exact `git.deploymentEnabled` value currently in effect (no
  `git` block exists in the repository's `vercel.json`, meaning Vercel's
  documented default — automatic deployment enabled for every branch —
  is presumed to apply based on observed behavior, but this was not read
  directly from a Vercel project-settings API response).
- Whether "staged production deployment + promote" (`--skip-domain` /
  `POST /v10/projects/{id}/promote/{deploymentId}`) is available on the
  current Vercel plan tier for this team. Vercel's own documentation
  confirms the mechanism exists at the CLI/API level (see Section 11,
  Authoritative Vercel references); plan-tier availability was not
  independently confirmed for this specific team account.
- Whether "rolling release" (Vercel's gradual-traffic-shift feature) is
  configured or available on this plan. Not queried — no MCP tool
  exposed this setting, and it is not central to any of the three
  compared options below.

### 2.2 GitHub — confirmed via direct, unauthenticated `api.github.com` REST calls (live, this task; the repository is public, so branch metadata is readable without a token)

| Setting                                                              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Default branch                                                       | `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `GET /repos/.../{repo}`                          |
| `main` branch protection (**at the start of Phase 1C-A preflight**)  | `protected: false` — no branch protection or ruleset existed at all. `required_status_checks.enforcement_level: "off"`. **This state no longer applies — see Section 2.3.**                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `GET /repos/.../branches/main`                   |
| Quality Gate workflow trigger                                        | `pull_request` only (no `push`, no `workflow_dispatch`) — confirmed by reading `.github/workflows/quality-gate.yml` directly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | file read                                        |
| Postgres Migration Check workflow trigger                            | `pull_request` **and** `workflow_dispatch: {}` — confirmed by reading `.github/workflows/postgres-migration-check.yml` directly. `workflow_dispatch` is already configured in this existing repository workflow. A successful historical manual execution was not independently verified during Phase 1C-A: `gh api repos/.../actions/workflows/postgres-migration-check.yml/runs?event=workflow_dispatch` returned `total_count: 0` (confirmed during the correction pass on this PR). Configuration presence is not, by itself, evidence that manual dispatch has ever actually been exercised successfully in this repository. | file read; live `gh api` call, correction pass   |
| GitHub Actions secrets currently referenced by any existing workflow | **None.** `grep -c "secrets\."` against every `.github/workflows/*.yml` file returns zero matches across the board. Any new release/promotion workflow would start from an empty secrets footprint, not modify an existing one.                                                                                                                                                                                                                                                                                                                                                                                                   | file read                                        |
| GitHub Actions secrets configured on the repository (names)          | **Not independently confirmed** — `GET /repos/.../actions/secrets` requires authenticated repo-admin-scoped access; unauthenticated request returned `401 Requires authentication`. No token was requested or used for this design-only task.                                                                                                                                                                                                                                                                                                                                                                                     | live API call (401 response)                     |
| Allowed merge methods (squash / merge commit / rebase)               | Per the `Protect main` ruleset's `pull_request` rule (Section 2.3): `allowed_merge_methods: ["merge", "squash", "rebase"]` — all three are explicitly configured as allowed. Only the merge-commit method has actually been empirically exercised in this repository's history (PR #3, #4, #5, via `gh pr merge --merge`); squash and rebase have never been used, though the ruleset confirms they are not blocked.                                                                                                                                                                                                              | ruleset object (Section 2.3) + empirical history |

### 2.3 GitHub — `Protect main` repository ruleset (created by the owner during independent review of this PR; read live via authenticated `gh api` during this correction pass)

The owner created and activated a GitHub repository ruleset named
`Protect main` through the GitHub UI while this PR was under independent
review. This ruleset was **not** created by Claude and is **not**
modified by this correction — it is read here, machine-verified via the
GitHub REST API, to update this document's account of `main`'s actual
current protection state.

```
gh api repos/dvrboxzone-bit/aiscentra3-1/rulesets
gh api repos/dvrboxzone-bit/aiscentra3-1/rulesets/20093586
gh api repos/dvrboxzone-bit/aiscentra3-1/rules/branches/main
gh api repos/dvrboxzone-bit/aiscentra3-1/branches/main
```

| Field                                             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ruleset ID                                        | `20093586`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Name                                              | `Protect main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Target                                            | `branch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Source type                                       | `Repository`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Source                                            | `dvrboxzone-bit/aiscentra3-1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Enforcement                                       | `active`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Included refs                                     | `["~DEFAULT_BRANCH"]` (i.e. `main`, the repository's default branch)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Excluded refs                                     | `[]` (none)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Rule types present                                | `deletion`, `pull_request`, `required_status_checks`, `non_fast_forward`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pull_request` parameters                         | `required_approving_review_count: 0`, `dismiss_stale_reviews_on_push: false`, `required_reviewers: []`, `require_code_owner_review: false`, `require_last_push_approval: false`, `required_review_thread_resolution: true`, `allowed_merge_methods: ["merge", "squash", "rebase"]`                                                                                                                                                                                                                                                      |
| `required_status_checks` parameters               | `strict_required_status_checks_policy: true` (branch must be up to date before merge), `do_not_enforce_on_create: false`, `required_status_checks: [{ context: "Quality Gate (format, lint, type-check, test, build)", integration_id: 15368 }]`                                                                                                                                                                                                                                                                                        |
| Deletion restriction                              | Present (`deletion` rule type) — branch deletion is blocked                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Non-fast-forward / force-push restriction         | Present (`non_fast_forward` rule type) — force-push is blocked                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bypass_actors`                                   | `[]` (empty array — returned directly by the API, not withheld)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `current_user_can_bypass`                         | `"never"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `branches/main` top-level `protected` field       | `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `branches/main` legacy `protection.enabled` field | `false` — **this is not a contradiction.** GitHub's Repository Rulesets (used here) and the older, separate "classic branch protection rules" API are two different mechanisms. The `protection` sub-object on `GET /repos/.../branches/main` only reflects the legacy mechanism, which was never configured (and does not need to be, since the ruleset is the active enforcement path). The top-level `protected: true` field, together with the full ruleset read above, is the authoritative confirmation that `main` is protected. |

**Note on `required_approving_review_count: 0`:** the ruleset's
`pull_request` rule is present and active (meaning direct pushes are
blocked and a pull request is mandatory to reach `main`), but it does
not currently mandate a minimum number of human approving reviews before
merge. This is disclosed exactly as configured, not rounded up to "requires
review."

**Bypass actors:** the API returned a fully populated, empty
`bypass_actors: []` list and `current_user_can_bypass: "never"` — this
was directly exposed by the available read request, not withheld, so no
fallback disclaimer about an unconfirmed bypass list is needed here.

### 2.4 Chronology of `main`'s protection state

```
At the beginning of Phase 1C-A preflight, main was independently
confirmed unprotected (protected: false).

During independent review of Draft PR #6, the owner created and
activated the repository ruleset "Protect main".

The current protected-main state is the exact ruleset configuration
returned by the GitHub repository API during this correction task
(Section 2.3).
```

No statement anywhere in this document should be read as claiming `main`
is still unprotected — that was the state only at the start of Phase
1C-A, before the owner's independent action described above.

### 2.5 Target protection requirements for `main` — confirmed against the actual ruleset (Section 2.3)

Protected main is a **mandatory prerequisite** for introducing any
production deployment credential or release workflow. This follows
Constitution Articles 15.3 and 16.2 and is not an optional enhancement.

| Requirement                                                         | Status                                                                                                                                                                                                     | Evidence                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Direct push forbidden                                               | **Confirmed**                                                                                                                                                                                              | `pull_request` rule type present and active; `~DEFAULT_BRANCH` is the only included ref                 |
| Changes only via PR                                                 | **Confirmed**                                                                                                                                                                                              | Same as above                                                                                           |
| Required Quality Gate mandatory                                     | **Confirmed**                                                                                                                                                                                              | `required_status_checks` rule requires context `"Quality Gate (format, lint, type-check, test, build)"` |
| Force-push forbidden                                                | **Confirmed**                                                                                                                                                                                              | `non_fast_forward` rule type present                                                                    |
| Branch deletion forbidden                                           | **Confirmed**                                                                                                                                                                                              | `deletion` rule type present                                                                            |
| Bypass disabled or limited to an audited emergency path             | **Confirmed disabled**                                                                                                                                                                                     | `bypass_actors: []`, `current_user_can_bypass: "never"`                                                 |
| Release workflow and `vercel.json` cannot be changed by direct push | **Confirmed as a consequence of the above** — any change to those files, like any other file, must go through the same PR + required-Quality-Gate path, since the ruleset does not exempt any path or file | Same ruleset rules apply repository-wide to the protected ref, not per-file                             |

**Not yet confirmed (tracked as Phase 1C-B1, not resolved by this document):**

- Whether the required Quality Gate check, as currently configured
  (`pull_request`-triggered only), is actually evaluated against the
  exact final commit SHA that lands on `main`, or only against the
  ephemeral pre-merge synthetic merge commit (`refs/pull/<N>/merge`) —
  see Section 8 for the precise distinction already documented for this
  PR's own CI history. This is the concrete, open engineering gap Phase
  1C-B1 exists to close.

## 3. Comparison of options

### Option A — Separate production branch

```
feature branch → PR → main
                          │
                (separate owner decision)
                          │
                          ▼
              main SHA → production branch
                          │
              production branch → Vercel production
```

| Criterion                                       | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drift risk between `main` and production branch | **Real and ongoing.** Every production promotion is itself a second Git operation (fast-forward or merge) that must be tracked, or `main` and the production branch silently diverge over time. `main` is now protected by the active `Protect main` ruleset (Section 2.3), but Option A still creates a separate drift and governance surface because the production branch would require its own protection, fast-forward-only policy, exact-SHA provenance and synchronization controls — none of which the `Protect main` ruleset automatically extends to a second branch. |
| Second PR or fast-forward needed                | Yes — either a fast-forward push (simple, but is itself an unprotected write to a ref Vercel treats as the deployment source) or a second PR (adds review overhead, duplicated CI run before promotion).                                                                                                                                                                                                                                                                                                                                                                        |
| SHA provenance                                  | Good, if disciplined: the production branch's HEAD SHA is always traceable to a specific `main` commit. `main` is now protected by the active `Protect main` ruleset (Section 2.3), but that protection does not automatically extend to a second, separate production branch — provenance there is only as strong as the discipline enforcing its own fast-forward-only rule, which would require its own dedicated protection to match.                                                                                                                                       |
| Rollback                                        | Fast-forward or reset the production branch to a prior SHA, then let Vercel's existing Git integration redeploy automatically — reuses the exact mechanism already proven to work.                                                                                                                                                                                                                                                                                                                                                                                              |
| Owner burden                                    | Low if a thin automation triggers the fast-forward on owner confirmation (e.g. a `workflow_dispatch`-triggered job); higher if the owner is expected to run Git commands directly, which Constitution Article 2.1/23.1 explicitly says the owner should not be required to do.                                                                                                                                                                                                                                                                                                  |
| Preview deployments preserved                   | Yes — untouched; PR branches keep deploying Preview exactly as today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Option B — Disable automatic deployment for `main`, use staged build + explicit promotion

```json
{ "git": { "deploymentEnabled": { "main": false } } }
```

then, after a separate owner decision:

```
checkout exact main SHA → staged production build (--skip-domain) →
verification → explicit promote (assign domains)
```

| Criterion                                | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview branches still auto-build        | **Yes, per Vercel's own documentation** (see "Authoritative Vercel references" at the end of this document, `git.deploymentEnabled` entry): `deploymentEnabled` is a per-branch map; only branches explicitly listed as `false` are affected, every other branch (including all PR/feature branches) keeps the existing default (`true`) behavior — Preview deployments for pull requests are unaffected.                                                                                                                                                                                                                                                                 |
| How the staged deployment is created     | Vercel CLI `vercel --prod --skip-domain` (confirmed via Vercel's own documentation, Section 11, Authoritative Vercel references) builds and deploys with `target: production` in Vercel's internal bookkeeping, but does **not** assign the production domain aliases — the deployment is reachable only at its unique preview-style URL until explicitly promoted.                                                                                                                                                                                                                                                                                                       |
| Avoiding immediate domain takeover       | This is exactly what `--skip-domain` (or the equivalent REST call) is designed for — confirmed directly in Vercel's documentation, not inferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Vercel token / minimum scope required    | A new Vercel token restricted to the AIscentra project, capable of triggering a deployment and calling the promote endpoint (`POST /v10/projects/{id}/promote/{deploymentId}`) and the rollback endpoint (Section 11). Whether Vercel supports further operation-level restriction beyond project-level has not been independently confirmed. This is a **new credential that does not exist today** (Section 2.2 confirms zero secrets are currently referenced by any workflow) — its creation, storage as a GitHub Environment secret (not a plain repository secret), and exact scope must be a separate, explicit decision, not assumed as part of this design task. |
| Proving the exact SHA                    | Strong — the staged build step checks out an exact, owner-confirmed commit SHA before building; the resulting deployment's `githubCommitSha` metadata field (already observed and relied upon throughout this session for evidence) directly proves which commit was actually built, exactly as already done for every deployment inspected in this and prior tasks.                                                                                                                                                                                                                                                                                                      |
| Promote mechanism (normal release)       | `vercel promote <deployment-url>` (or the REST equivalent, `POST /v10/projects/{id}/promote/{deploymentId}`) is Vercel's documented mechanism for turning a staged deployment that has never yet served production traffic into the current production deployment — confirmed as a first-class, documented mechanism, not a workaround.                                                                                                                                                                                                                                                                                                                                   |
| Rollback mechanism (emergency, separate) | `vercel rollback <previous-deployment-url-or-id>` (a distinct CLI command from `promote`) is Vercel's documented mechanism for restoring production traffic to a deployment that has **already** served production traffic in the past. Vercel's own documentation states that a previously-promoted deployment cannot simply be re-promoted — rollback is the required path for that case. Rollback is not represented here as the same operation as promote against an older deployment ID; it is treated as a separate, fail-closed mode (Section 6/7), requiring its own explicit owner authorization at the time it is exercised.                                    |

### Option C — Deploy Hook or manual GitHub Actions release workflow

| Criterion                                   | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the hook create production or preview? | A Vercel Deploy Hook is bound to a specific Git branch/ref at creation time and always triggers a deployment targeting whatever environment that branch is configured for — for `main`, that would currently still resolve to a production deployment as configured today, so a bare Deploy Hook alone does **not** by itself separate merge from deployment; it only changes _what_ triggers the deployment (a webhook call instead of the push itself). To achieve real separation, Option C must be combined with Option B's `deploymentEnabled: { main: false }` — the hook (or a `workflow_dispatch`-triggered GitHub Actions job) then becomes the _only_ way to initiate the now-disabled automatic path, functionally converging with Option B's mechanism rather than being a fully independent fourth option. |
| Hook URL protection                         | The hook URL itself is a bearer-token-equivalent secret (anyone with the URL can trigger a deployment) — it would need to be stored as a GitHub Actions secret, again a **new credential**, and rotated if ever exposed (e.g. accidentally logged, as this Constitution's Article 12.8 explicitly warns against for any secret).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Guaranteeing the exact commit SHA           | Weaker than Option B's explicit staged-build-from-SHA step **unless** the hook/workflow explicitly checks out and passes a specific SHA rather than "whatever `main`'s HEAD currently is" at the moment the hook fires. The `Protect main` ruleset reduces unauthorized ref movement, but a hook or workflow that deploys the moving `main` ref instead of an explicit approved SHA still has a time-of-check/time-of-use risk if another authorized merge reaches `main` before the release action executes.                                                                                                                                                                                                                                                                                                           |
| Accidental re-trigger risk                  | A leaked or reused Deploy Hook URL can be called by anyone, any number of times, with no owner-visible confirmation step — this is a real, distinct risk not present in Option B's promote-only model (which requires a specific deployment ID that only exists after a specific, logged staged build).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Relative complexity vs. Option B            | Roughly comparable operational complexity, but with a strictly worse secret-handling profile (a bearer URL vs. a scoped API token usable only through an explicit, auditable GitHub Actions job) and a weaker default SHA-pinning guarantee. Not recommended as a _standalone_ mechanism; a `workflow_dispatch`-triggered Actions job that itself calls the Vercel API (effectively Option B's mechanism, orchestrated via GitHub Actions rather than the CLI) is a valid refinement of Option B, not a genuinely separate architecture.                                                                                                                                                                                                                                                                                |

## 4. Recommendation

**Option B after mandatory Phase 1C-B1:**

```
Protected Main + exact-SHA CI first, then disabled automatic deployment
for main + project-scoped Vercel token + protected owner-triggered
staged release and explicit promotion.
```

Protected Main (Section 2.3-2.5) is now in place as an external,
owner-driven fact, confirmed via the GitHub API during this correction
pass. Phase 1C-B1 (Section 5) has since been independently confirmed
complete — the required Quality Gate check is proven to apply to the
exact final commit SHA that lands on `main`, not merely to the ephemeral
pre-merge synthetic merge commit. Production tokens and release
workflows (Phase 1C-B2) are still not represented as implemented or
authorized by this document — B2 remains its own separate task requiring
its own separate, explicit owner authorization.

Rationale, weighed directly against the stated selection criteria:

- **Separate owner gate for merge:** already true today (PR review before merge, now additionally enforced structurally by the `Protect main` ruleset's `pull_request` rule — direct pushes to `main` are blocked, not merely discouraged by convention).
- **Separate owner gate for production:** Option B is the only one of the three that makes this gate _structural_ rather than _procedural_ — with `deploymentEnabled: { main: false }`, no push to `main` can trigger a production deployment by itself; explicit promotion becomes the only path. Option A's protection is only as strong as discipline around the second branch, which the ruleset does not automatically extend to.
- **Exact SHA-pinning:** Option B's staged build step checks out and builds one exact, named commit SHA on demand — stronger and more directly verifiable (via the deployment's own `githubCommitSha` metadata field, which this session has repeatedly used as primary evidence) than Option A's reliance on a second Git ref staying in sync. This exact-SHA guarantee is the specific engineering property Phase 1C-B1 exists to prove end-to-end (Section 5), not merely assume.
- **PR Preview preserved:** confirmed unaffected under Option B (Section 3, Option B row 1) — this is a hard Vercel-documented guarantee (`deploymentEnabled` is a per-branch map defaulting to `true` for unlisted branches), not an assumption.
- **No manual owner code/CLI work:** achievable under Option B only if the promotion step is wrapped in a `workflow_dispatch` GitHub Actions job the owner can trigger from the GitHub UI (a button, effectively) rather than requiring the owner to run `vercel promote` locally — this is a **required part of the proposed Phase 1C-B2 implementation scope**, not optional polish, per Constitution Article 2.1's explicit requirement that the owner not be expected to run technical commands.
- **Minimal secret scope:** requires exactly one new secret (a project-scoped Vercel API token), introduced only in Phase 1C-B2, stored only as a GitHub Environment secret restricted to a `production` environment job (Section 6) — never before Phase 1C-B1 is complete.
- **No irreversible change:** `git.deploymentEnabled` is itself a reversible, single-line `vercel.json` change; nothing about Option B forecloses reverting to full automatic deployment later.
- **Clear rollback:** `vercel rollback <previous-deployment-url-or-id>` — a distinct command from `vercel promote` — is Vercel's own documented emergency-recovery mechanism (Section 11), specifically for restoring production traffic to a deployment that has already served production before. It is not represented as "the same `vercel promote` call against an older deployment"; Section 7 makes clear that exercising it is not authorized by this document.
- **Fit for confirmed plan/tooling:** every mechanism Option B relies on (`--skip-domain`, `promote`, `rollback`, per-branch `deploymentEnabled`) is documented by Vercel's own current documentation (Section 11); the two unconfirmed items — exact plan-tier availability of staged promotion for normal release, and separately, of rollback to an arbitrary prior deployment — remain open questions (Section 10, items 1 and 2), not assumed.

## 5. Phase 1C split into two sequential implementation stages

Phase 1C is not a single implementation task. It is split into two
sequential stages, tracked explicitly in the Repair Roadmap:

### Phase 1C-B1 — Protected Main and Exact-SHA CI

**Status: COMPLETED.** (Historical status at design/preflight time was
_PARTIALLY COMPLETED_ — see "State at design/preflight" below, retained
unmodified for the audit trail. "State after B1 implementation" reflects
the current, independently verified status.)

#### State at design/preflight (historical, unmodified)

Completed (external, owner-driven):

- The owner created and activated the `Protect main` ruleset (Section 2.3). Its actual configuration is machine-confirmed, not assumed.

Remained open at that time, as a separate future implementation task:

- Ensure the Quality Gate check is evaluated against the actual final commit SHA that lands on `main` — at that time, `quality-gate.yml` triggered only on `pull_request`, meaning GitHub Actions checks out and tests `refs/pull/<N>/merge` (a synthetic merge commit), not the PR's head commit directly, and did not run again on the resulting merge commit after merge (see Section 8 for the concrete evidence of that distinction, as it stood before this closeout).
- One reasonable technical direction (not yet decided or implemented at that time) was adding a `push: branches: [main]` trigger to the existing Quality Gate workflow, or making it reusable and invoked post-merge.
- Prove, with real evidence, that a successful check reported against `main` corresponds to the exact commit SHA actually on `main` at that time.
- Confirm the required-status-check enforcement in the `Protect main` ruleset continues to apply correctly after any workflow-trigger change.
- Explicitly out of scope for 1C-B1 at that time: any Vercel deployment-behavior change, any Vercel token, any GitHub production secret.

#### State after B1 implementation (current, this update)

Phase 1C-B1 is now considered complete. Independently verified via
primary artifacts, not merely reported:

- PR #8 (`ci/exact-main-sha-quality-gate` → `main`) implemented exactly
  the technical direction anticipated above: a `push: branches: [main]`
  trigger added alongside the existing `pull_request` trigger, an
  event-specific fail-closed format-check split (PR-only step uses
  `github.base_ref`; push-only step uses `github.event.before` with a
  full-repository fallback if that SHA is missing, all-zero, or not
  locally available), and a new diagnostic step
  ("Confirm tested commit identity") that asserts
  `git rev-parse HEAD == github.sha` and fails the job if they diverge.
- PR #8 merged as commit `0bf8fe15604808a7ca94b532689f6b209804aed9`
  (`mergedAt: 2026-07-31T12:05:56Z`, merged by the repository owner, not
  a bot).
- The automatic `push`-triggered Quality Gate run
  (`30629372155`, job `91151923416`) fired on that exact merge and
  confirmed: `event=push`, `head_branch=main`, `ref=refs/heads/main`,
  `head_sha` equal to the merge SHA. The "Confirm tested commit
  identity" step succeeded, which is itself the proof that
  `git.head == github.sha` on this run (the step's own command fails
  non-zero on any mismatch). The push-specific format-check step
  succeeded using the real prior `main` SHA
  (`c41a1c1b9fcba6fb96545c5ac13673da3e261f40`, independently confirmed
  via the repository Events API, not just the workflow's own claim) as
  its comparison base — the fail-closed full-repository fallback was
  not triggered. All remaining steps (lint, type-check, 95/95 tests,
  production build on Next.js `16.2.12`, both dependency-audit evidence
  steps, all three artifact uploads) succeeded.
- Production dependency audit on this exact commit (artifact ID
  `8792716966`): `critical 0, high 0, moderate 0, low 2, total 2`,
  independently re-confirmed via a local `npm audit --omit=dev` run
  against the exact merge commit after establishing that the merge
  changed only the workflow file (no `package.json`/`package-lock.json`
  change).
- The automatic Vercel production deployment triggered by this same
  merge (`dpl_A9wVLvHYqrvwhHE2NJANxatCmi9U`) reached `state: READY`,
  `target: production`, `source: git`, `githubCommitRef: main`,
  `githubCommitSha` equal to the merge SHA.
- Production evidence for this deployment: the connected Vercel
  deployment/API (a primary artifact, not a model report) confirms
  `dpl_A9wVLvHYqrvwhHE2NJANxatCmi9U` reached `state: READY`,
  `target: production`, `source: git`, `githubCommitRef: main`,
  `githubCommitSha` equal to the merge SHA. Independent external
  verification through a direct fetch of the production URL
  (`web_fetch`, a tool distinct from this sandbox's blocked `curl`
  proxy) on 31 July 2026 successfully retrieved real, live homepage
  content from `https://aiscentra.com/` — positive evidence the
  deployment genuinely serves production traffic, not merely reported
  as such. `/api/health` could not be independently confirmed this way:
  the site's own `robots.txt` disallows automated access to that path
  for the `web_fetch` tool. `/opengraph-image` returned a tool-side
  "image content not supported" error rather than a network-level
  failure, consistent with the endpoint serving real binary image
  content, but not by itself a confirmation of the literal HTTP status
  code or `content-type` header value. Claude's `bash`-sandboxed `curl`
  could not reach any of these URLs directly
  (`x-deny-reason: host_not_allowed`) — a disclosed sandbox limitation,
  not a production failure.

**Explicitly not claimed by this closeout:** automatic Vercel production
deployment from `main` is still fully enabled — B1 did not touch it.
Phase 1C as a whole remains incomplete until Phase 1C-B2 also lands.

### Phase 1C-B2 — Manual Production Release

Only after Phase 1C-B1 is fully complete (now independently confirmed,
per the above):

- Disable automatic Git deployment for `main` (`git.deploymentEnabled: { "main": false }`).
- Preserve automatic PR Preview deployments (unaffected by the above, per Vercel's documented per-branch default).
- Add an owner-triggered production release workflow (Section 6).
- Create a project-scoped Vercel token.
- Store the token only as a GitHub **Environment** secret (not a plain repository secret), scoped to a `production` environment requiring the job to declare `environment: production`.
- Perform staged deployment, verification, and explicit promotion against a specific, owner-approved commit SHA.

Phase 1C-B1's completion does not itself authorize, start, or scope
Phase 1C-B2. B2 requires its own separate implementation task and its
own separate, explicit owner authorization before any code, Vercel
token, or GitHub secret is introduced. It is **not** implemented,
authorized, or started by this document or by this governance-sync
update.

## 6. Exact-SHA release gate — mandatory conditions for the future Phase 1C-B2 release workflow

The following are binding design conditions for the Phase 1C-B2
implementation task, not yet built or authorized by this document:

- The workflow input accepts a full 40-character commit SHA.
- The input value is validated against a strict format check before any other action.
- The workflow verifies the commit exists in the repository.
- The workflow verifies the commit is present in `origin/main`'s history.
- For a normal release, the workflow verifies the input SHA matches `origin/main`'s current HEAD exactly.
- The workflow verifies the Quality Gate check for that exact commit SHA has `conclusion: success` (dependent on Phase 1C-B1 making this check meaningful against the real `main` commit, not only the synthetic merge commit).
- The resulting deployment's own metadata (`githubCommitSha`) is confirmed to match the same input SHA before promotion proceeds.
- Promotion is refused on any mismatch at any of the checks above.
- Workflow permissions are explicitly `contents: read`; all other GitHub permissions are explicitly set to `none` where the platform allows it.
- The production secret is accessible only to a job declaring `environment: production` — never a job without that declaration.
- The token value is never written to workflow logs.
- Full API responses that could contain sensitive data are never dumped to logs in full — only the specific fields needed for verification.
- Workflow `concurrency` settings prevent two production releases from running simultaneously.
- Normal release and rollback (Section 7) are implemented as distinct modes or distinct workflows — never the same code path with an implicit branch.

"Most recent successful CI run" is explicitly rejected as a promotion
trigger anywhere in this design — every promotion decision must be tied
to one specific, explicitly supplied commit SHA.

## 7. Rollback requires separate explicit authorization

A rollback drill (exercising `vercel rollback <approved-prior-deployment-id-or-url>` — Vercel's dedicated rollback command, distinct from `vercel promote` — to reverse a live production release) is a required acceptance step before the Phase 1C-B2 release process is considered load-bearing — but performing that drill changes production traffic, and therefore requires its own separate, explicit owner authorization at the time it is performed. It is not authorized by:

- Design PR #6 (this document);
- this correction task;
- any future Phase 1C-B2 implementation task, absent a distinct,
  separate owner decision at that time.

The rollback code path itself must call `vercel rollback` (or its
dedicated equivalent), must accept a specific target deployment ID as
input, and must not be merged into, or share an implicit branch with,
the normal-release code path that calls `vercel promote` (Section 6).

## 8. CI evidence for this PR — precise distinction between PR head and synthetic merge

This PR's own CI history is used here as the concrete illustration of
the exact gap Phase 1C-B1 exists to close:

```
PR head SHA (pre-correction):
137f29a3eb38411b7034eec2c4abe742e0f9db62

CI-tested synthetic merge SHA (pre-correction):
6c69cf55d36122b773ce48e6f0d70fecb6ce4791

CI run: 30598397318
CI conclusion: success
```

The GitHub Actions runner did not check out and test the PR head commit
directly. This is established two ways:

1. **Confirmed by direct file inspection (this task):** `.github/workflows/quality-gate.yml`'s checkout step (`actions/checkout@v4`) has no explicit `ref:` parameter, and the workflow's only trigger is `pull_request` (Section 2.2). GitHub's own documented default behavior for `pull_request`-triggered workflows without an explicit `ref:` is to check out `refs/pull/<N>/merge` — a synthetic commit GitHub constructs by merging the PR head into its base at evaluation time, distinct from either the head SHA or the eventual real merge commit SHA.
2. **Corroborated by the PR object itself:** `gh api repos/.../pulls/6` returns a `merge_commit_sha` (`6c69cf55d36122b773ce48e6f0d70fecb6ce4791`) that is a real, distinct commit from the PR head SHA (`137f29a3eb38411b7034eec2c4abe742e0f9db62`) — confirming a synthetic merge commit genuinely exists for this PR, separate from its head.

**Disclosed limitation:** an attempt to independently fetch and quote
the raw GitHub Actions checkout step log text for run `30598397318`
during this correction pass returned `403 Forbidden` from GitHub's
log-archive download endpoint (`results-receiver.actions.githubusercontent.com`)
— the provided PAT does not have sufficient scope for log-archive
download, even though it can read run/job/step metadata via the REST
API. The claim above is therefore based on (1) and (2), not on a direct
quote of runtime log text, and this limitation is disclosed rather than
worked around by asserting the log content without having read it.

Any local commands run directly against the head commit in this or
prior sessions (e.g. `npm test`, `npm run build` executed in a local
clone checked out at the head SHA) are a separate kind of evidence from
the GitHub Actions run itself, and are labeled as such wherever they
appear in this project's PR history — they do not substitute for, and
should not be described as, "CI ran directly on the head commit."

This exact distinction — what the required status check actually
evaluates versus what a human might assume it evaluates — is precisely
the ambiguity Phase 1C-B1 must resolve for the real `main` branch before
any release workflow can safely trust a "Quality Gate: success" signal
as proof about a specific `main` commit.

## 9. Proposed implementation scope for Phase 1C-B2 (NOT authorized by this document)

- **Files:** `vercel.json` (add `"git": { "deploymentEnabled": { "main": false } }`); one new `.github/workflows/*.yml` file (e.g. `production-release.yml`) with `on: workflow_dispatch` only, implementing the Section 6 exact-SHA gate, using a newly-created, narrowly-scoped Vercel API token stored as a GitHub **Environment** secret.
- **External settings:** creation of the new Vercel API token itself (owner action, outside this repository); adding it as a GitHub Environment secret (requires repo-admin write access, itself a separate, explicit action).
- **Required credentials / minimum scope:** a Vercel token restricted to the AIscentra project and capable of the deployment and promotion operations required by the release workflow. Whether Vercel supports further operation-level restriction to only those actions has not been independently confirmed and must be verified before credential creation. Not created before Phase 1C-B1 is complete; to be stored only as a GitHub Environment secret when eventually created.
- **Rollout:** implemented and merged as its own PR, only after Phase 1C-B1 is independently confirmed complete; tested first with a real staged-and-promoted deployment against a low-risk commit (e.g. a docs-only change) before being relied upon for any substantive release.
- **Rollback:** see Section 7 — requires separate explicit owner authorization at the time it is exercised; the `vercel.json` change itself can also be reverted (single line) as an immediate fallback if the new workflow proves unreliable.
- **Acceptance criteria:** (a) a merge to `main` no longer produces any deployment with `target: production` automatically — confirmed by observing at least one real merge with zero automatic production deployment; (b) the new `workflow_dispatch` job, when triggered with a specific SHA, produces a deployment whose `githubCommitSha` metadata field exactly matches that SHA, per the Section 6 gate; (c) Preview deployments for at least one concurrent PR continue to build automatically and are unaffected; (d) a rollback drill using `vercel rollback <approved-prior-deployment-id-or-url>` (Section 7) — not `vercel promote` — is exercised at least once successfully, under its own separate owner authorization, before this is considered load-bearing.

## 10. Open questions requiring an explicit owner decision (not resolved by this document)

1. Does the current Vercel team plan support staged production deployment + promote for a **normal release** (`--skip-domain` / the promote REST endpoint) in practice, not just in Vercel's general documentation? This should be confirmed directly against the team's actual plan/billing page before Phase 1C-B2 is scoped as a task, since this design-only task had no tool capable of reading plan-tier feature availability.
2. Does the current Vercel team plan support **rollback** to a specifically-selected older prior production deployment (as opposed to only the immediately-previous one, which Vercel documents as the Hobby-tier limit)? This is a separate question from Open Question 1 — normal-release promotion and emergency rollback are different mechanisms with potentially different plan-tier availability, and neither has been independently confirmed for this team's actual plan.
3. Who creates the new Vercel API token, and under what account (the current project creator/owner's personal account, or a dedicated service-style Vercel user)? This is explicitly an owner decision per Constitution Article 2.1/23.1 and was not decided by this task.
4. Is Option A (separate production branch) preferred over Option B for any reason not weighed above (e.g. team familiarity, a strong preference for Git-native mechanisms over Vercel-API-based ones)? This design document recommends Option B, but the choice remains the owner's/ChatGPT's to make explicitly.
5. What is the exact technical approach for Phase 1C-B1's exact-SHA CI (a `push: branches: [main]` trigger added to the existing workflow, a separate reusable workflow, or another mechanism)? Not decided by this document — left to the future 1C-B1 implementation task.

## 11. Authoritative Vercel references

| Mechanism                                             | URL                                                                                                     | What it documents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git.deploymentEnabled` (global and per-branch)       | https://vercel.com/docs/project-configuration/git-configuration                                         | Disabling automatic Git deployments globally or for specific branches via `vercel.json`; per-branch map defaults unlisted branches to `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Staged production deployment via `--skip-domain`      | https://vercel.com/docs/cli/deploying-from-cli                                                          | Creating a production-targeted deployment without immediately assigning production domain aliases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `vercel --prod` / `vercel --prod --skip-domain`       | https://vercel.com/docs/cli/deploy                                                                      | CLI production deployment creation, with and without domain assignment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `vercel promote` (CLI)                                | https://vercel.com/docs/cli                                                                             | Promoting a specific deployment to become the current production deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Promote to production (REST)                          | https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-given-deployment                | `POST /v10/projects/{projectId}/promote/{deploymentId}` — does not rebuild the deployment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Post-promotion verification                           | https://vercel.com/docs/deployments/promote-preview-to-production                                       | Checking production logs and domain response after promotion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Project-scoped tokens                                 | https://vercel.com/docs/cli/tokens                                                                      | Vercel personal access tokens; documented as scoped to a user account, and optionally to a single project. The token can be restricted to the AIscentra Vercel project. Whether Vercel supports further operation-level restriction to only deploy and promote has not yet been independently confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `vercel rollback` (CLI)                               | https://vercel.com/docs/cli/rollback                                                                    | `vercel rollback <previous-deployment-url-or-id>` restores production traffic to a previously-served production deployment — a distinct command from `vercel promote`. `vercel rollback status` reports pending-rollback state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Rollback (recovery guide)                             | https://vercel.com/docs/deployments/rollback-production-deployment                                      | Documents `vercel rollback <previous-deployment-url-or-id>` as the emergency-recovery mechanism, distinct from `vercel promote`. Verified exact current page text: "On the Hobby plan, you can only roll back to the immediately previous production deployment. Pro and Enterprise plans can roll back to any previous production deployment by specifying the deployment URL." Rollback changes live production traffic and requires its own separate, explicit owner authorization at the time it is exercised (Section 7) — it is not pre-authorized by this document. Whether this specific team's plan tier supports rolling back to an arbitrary prior deployment (versus only the immediately-previous one) has not been independently confirmed. |
| Rollback to previous production deployment (REST/SDK) | See "Rollback interface — public reference vs. current CLI implementation" immediately below this table |

**Explicitly not confirmed by any of the above for this specific team's
plan:** (1) whether staged production deployment and promote for a
normal release (`--skip-domain` + `vercel promote`) are actually
available in practice (not merely documented as a general Vercel
capability) on the current billing/plan tier for
`team_kcxAeWtnmoE4vJPkVHy2vbjT`; and (2) whether rollback to a
specifically-selected older prior production deployment (as opposed to
only the immediately-previous one) is available on this team's actual
plan tier. They remain Open Questions 1 and 2 respectively (Section 10)
and neither is asserted as available anywhere else in this document.

### Rollback interface — public reference vs. current CLI implementation

**Public REST/SDK contract.** The official Vercel REST/SDK reference
documents:

```
SDK method:
vercel.projects.requestRollback(...)

Public REST endpoint:
POST /v1/projects/{projectId}/rollback/{deploymentId}
```

**Current CLI implementation observation.** The current open-source
Vercel CLI, in `packages/cli/src/commands/rollback/request-rollback.ts`
(independently fetched and read in full during this correction pass,
`github.com/vercel/vercel`, `main` branch), contains a function literally
named `requestRollback` whose body calls:

```
POST /v9/projects/{projectId}/rollback/{deploymentId}
```

**Obligatory interpretation.** The public Vercel REST/SDK reference and
the current Vercel CLI implementation use different endpoint versions
for the same rollback operation: `/v1/...` in the public reference and
`/v9/...` in the current CLI source. This is documented as a version divergence,
not resolved by declaring either primary source false.

Phase 1C-B2 must not hard-code either raw rollback endpoint based only
on this design record. At implementation time, the exact supported
interface must be re-verified against current official documentation
and current tooling. The preferred implementation path is the supported
`vercel rollback` CLI command or the current official Vercel SDK method
`projects.requestRollback`, rather than a manually hard-coded private or
version-sensitive HTTP path.

**Independent verification performed this pass:** the CLI source file
content was independently fetched and its `/v9/...` call confirmed by
direct reading, matching exactly what this correction task specified as
the current CLI implementation observation. The specific public SDK/REST
documentation page asserting `/v1/...` was not independently located via
live search during this pass; its existence and content are recorded
here per this task's explicit instruction and are not disputed, but this
specific claim rests on the task's own assertion rather than a page
Claude independently fetched and read this pass — disclosed for
completeness, not as a basis for treating the divergence any
differently than instructed above.

## 12. What this document does NOT do

- It does not modify `vercel.json`, any GitHub Actions workflow, any application code, Supabase, Vercel project settings, domains, environment variables, or Deploy Hooks.
- It does not modify the `Protect main` ruleset (created independently by the owner, read here only).
- It does not create any Vercel token or GitHub secret.
- It does not start Phase 1C-B1 or Phase 1C-B2 implementation.
- It does not perform or authorize a rollback drill.
- It does not approve Product Vision v1.0.0.
- It does not merge any pull request.
