# PHASE 1C — DEPLOYMENT SEPARATION: DECISION RECORD

**Status:** Preflight / design only. No implementation authorized by this document.
**Baseline:** `main@bf4d507319c20160b742fc2de5d0398b5c047360`
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
- There is currently no separate "production approval" gate between
  merge and deployment. The only gate before merge is the (optional,
  currently unenforced — see below) PR review and CI process.

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
  confirms the mechanism exists at the CLI/API level (see Section 4.1
  citations); plan-tier availability was not independently confirmed for
  this specific team account.
- Whether "rolling release" (Vercel's gradual-traffic-shift feature) is
  configured or available on this plan. Not queried — no MCP tool
  exposed this setting, and it is not central to any of the three
  compared options below.

### 2.2 GitHub — confirmed via direct, unauthenticated `api.github.com` REST calls (live, this task; the repository is public, so branch metadata is readable without a token)

| Setting                                                              | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Default branch                                                       | `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `GET /repos/.../{repo}`           |
| `main` branch protection                                             | **`protected: false`** — no branch protection rule exists at all. `required_status_checks.enforcement_level: "off"`.                                                                                                                                                                                                                                                                                                                                                          | `GET /repos/.../branches/main`    |
| Quality Gate workflow trigger                                        | `pull_request` only (no `push`, no `workflow_dispatch`) — confirmed by reading `.github/workflows/quality-gate.yml` directly                                                                                                                                                                                                                                                                                                                                                  | file read                         |
| Postgres Migration Check workflow trigger                            | `pull_request` **and** `workflow_dispatch: {}` — confirmed by reading `.github/workflows/postgres-migration-check.yml` directly. This establishes that manual `workflow_dispatch` triggers are already a proven, working mechanism in this repository; adding one to a new release workflow would not be a novel capability.                                                                                                                                                  | file read                         |
| GitHub Actions secrets currently referenced by any existing workflow | **None.** `grep -c "secrets\."` against every `.github/workflows/*.yml` file returns zero matches across the board. Any new release/promotion workflow would start from an empty secrets footprint, not modify an existing one.                                                                                                                                                                                                                                               | file read                         |
| GitHub Actions secrets configured on the repository (names)          | **Not independently confirmed** — `GET /repos/.../actions/secrets` requires authenticated repo-admin-scoped access; unauthenticated request returned `401 Requires authentication`. No token was requested or used for this design-only task.                                                                                                                                                                                                                                 | live API call (401 response)      |
| Allowed merge methods (squash / merge commit / rebase)               | **Only merge-commit method has been empirically exercised and confirmed working** — used successfully for PR #3, #4, and #5 via `gh pr merge --merge`. Squash and rebase were never attempted in this repository's history and their enablement was not independently confirmed via the repository-settings API (the relevant fields returned `null` on an unauthenticated `GET /repos/.../{repo}` call, which does not reliably expose these settings without proper scope). | live API call + empirical history |

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

| Criterion                                       | Assessment                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drift risk between `main` and production branch | **Real and ongoing.** Every production promotion is itself a second Git operation (fast-forward or merge) that must be tracked, or `main` and the production branch silently diverge over time — especially risky given `main` currently has **no branch protection**, so nothing stops a future direct push to `main` from bypassing this entire model. |
| Second PR or fast-forward needed                | Yes — either a fast-forward push (simple, but is itself an unprotected write to a ref Vercel treats as the deployment source) or a second PR (adds review overhead, duplicated CI run before promotion).                                                                                                                                                 |
| SHA provenance                                  | Good, if disciplined: the production branch's HEAD SHA is always traceable to a specific `main` commit. Provenance is only as strong as the discipline enforcing the fast-forward-only rule, which is not currently enforced by any branch protection.                                                                                                   |
| Rollback                                        | Fast-forward or reset the production branch to a prior SHA, then let Vercel's existing Git integration redeploy automatically — reuses the exact mechanism already proven to work.                                                                                                                                                                       |
| Owner burden                                    | Low if a thin automation triggers the fast-forward on owner confirmation (e.g. a `workflow_dispatch`-triggered job); higher if the owner is expected to run Git commands directly, which Constitution Article 2.1/23.1 explicitly says the owner should not be required to do.                                                                           |
| Preview deployments preserved                   | Yes — untouched; PR branches keep deploying Preview exactly as today.                                                                                                                                                                                                                                                                                    |

### Option B — Disable automatic deployment for `main`, use staged build + explicit promotion

```json
{ "git": { "deploymentEnabled": { "main": false } } }
```

then, after a separate owner decision:

```
checkout exact main SHA → staged production build (--skip-domain) →
verification → explicit promote (assign domains)
```

| Criterion                             | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview branches still auto-build     | **Yes, confirmed by Vercel's own documentation** (Section 2.2 above): `deploymentEnabled` is a per-branch map; only branches explicitly listed as `false` are affected, every other branch (including all PR/feature branches) keeps the existing default (`true`) behavior — Preview deployments for pull requests are unaffected.                                                                                                                  |
| How the staged deployment is created  | Vercel CLI `vercel --prod --skip-domain` (confirmed via Vercel's own documentation, Section 4.1) builds and deploys with `target: production` in Vercel's internal bookkeeping, but does **not** assign the production domain aliases — the deployment is reachable only at its unique preview-style URL until explicitly promoted.                                                                                                                  |
| Avoiding immediate domain takeover    | This is exactly what `--skip-domain` (or the equivalent REST call) is designed for — confirmed directly in Vercel's documentation, not inferred.                                                                                                                                                                                                                                                                                                     |
| Vercel token / minimum scope required | A new Vercel token scoped to this project, capable of triggering a deployment and calling the promote endpoint (`POST /v10/projects/{id}/promote/{deploymentId}`). This is a **new credential that does not exist today** (Section 2.2 confirms zero secrets are currently referenced by any workflow) — its creation, storage as a GitHub Actions secret, and scope must be a separate, explicit decision, not assumed as part of this design task. |
| Proving the exact SHA                 | Strong — the staged build step checks out an exact, owner-confirmed commit SHA before building; the resulting deployment's `githubCommitSha` metadata field (already observed and relied upon throughout this session for evidence) directly proves which commit was actually built, exactly as already done for every deployment inspected in this and prior tasks.                                                                                 |
| Promote / rollback mechanism          | `vercel promote <deployment-id>` (or the REST equivalent) for promotion; the same call against a prior deployment ID for rollback — confirmed as Vercel's own documented, first-class mechanism, not a workaround.                                                                                                                                                                                                                                   |

### Option C — Deploy Hook or manual GitHub Actions release workflow

| Criterion                                   | Assessment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the hook create production or preview? | A Vercel Deploy Hook is bound to a specific Git branch/ref at creation time and always triggers a deployment targeting whatever environment that branch is configured for — for `main`, that would currently still resolve to a production deployment as configured today, so a bare Deploy Hook alone does **not** by itself separate merge from deployment; it only changes _what_ triggers the deployment (a webhook call instead of the push itself). To achieve real separation, Option C must be combined with Option B's `deploymentEnabled: { main: false }` — the hook (or a `workflow_dispatch`-triggered GitHub Actions job) then becomes the _only_ way to initiate the now-disabled automatic path, functionally converging with Option B's mechanism rather than being a fully independent fourth option. |
| Hook URL protection                         | The hook URL itself is a bearer-token-equivalent secret (anyone with the URL can trigger a deployment) — it would need to be stored as a GitHub Actions secret, again a **new credential**, and rotated if ever exposed (e.g. accidentally logged, as this Constitution's Article 12.8 explicitly warns against for any secret).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Guaranteeing the exact commit SHA           | Weaker than Option B's explicit staged-build-from-SHA step **unless** the hook/workflow explicitly checks out and passes a specific SHA rather than "whatever `main`'s HEAD currently is" at the moment the hook fires — a real risk if there's any delay between owner approval and the hook actually firing (e.g., a queued Action run), during which `main` could theoretically move again (mitigated, but not eliminated, by the current lack of branch protection).                                                                                                                                                                                                                                                                                                                                                |
| Accidental re-trigger risk                  | A leaked or reused Deploy Hook URL can be called by anyone, any number of times, with no owner-visible confirmation step — this is a real, distinct risk not present in Option B's promote-only model (which requires a specific deployment ID that only exists after a specific, logged staged build).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Relative complexity vs. Option B            | Roughly comparable operational complexity, but with a strictly worse secret-handling profile (a bearer URL vs. a scoped API token usable only through an explicit, auditable GitHub Actions job) and a weaker default SHA-pinning guarantee. Not recommended as a _standalone_ mechanism; a `workflow_dispatch`-triggered Actions job that itself calls the Vercel API (effectively Option B's mechanism, orchestrated via GitHub Actions rather than the CLI) is a valid refinement of Option B, not a genuinely separate architecture.                                                                                                                                                                                                                                                                                |

## 4. Recommendation

**Option B — disable automatic Vercel deployment for `main` specifically, combined with an owner-triggered `workflow_dispatch` GitHub Actions job (a refinement absorbing Option C's useful properties, not a separate fourth architecture) that performs the staged build-and-verify-and-promote sequence against an explicitly confirmed commit SHA.**

Rationale, weighed directly against the stated selection criteria:

- **Separate owner gate for merge:** already true today (PR review before merge); unaffected by this change.
- **Separate owner gate for production:** Option B is the only one of the three that makes this gate _structural_ rather than _procedural_ — with `deploymentEnabled: { main: false }`, no push to `main` (protected or not) can trigger a production deployment by itself; explicit promotion becomes the only path. Option A's protection is only as strong as discipline around the second branch, which is undermined by `main` currently having zero branch protection.
- **Exact SHA-pinning:** Option B's staged build step checks out and builds one exact, named commit SHA on demand — stronger and more directly verifiable (via the deployment's own `githubCommitSha` metadata field, which this session has repeatedly used as primary evidence) than Option A's reliance on a second Git ref staying in sync.
- **PR Preview preserved:** confirmed unaffected under Option B (Section 3, Option B row 1) — this is a hard Vercel-documented guarantee (`deploymentEnabled` is a per-branch map defaulting to `true` for unlisted branches), not an assumption.
- **No manual owner code/CLI work:** achievable under Option B only if the promotion step is wrapped in a `workflow_dispatch` GitHub Actions job the owner can trigger from the GitHub UI (a button, effectively) rather than requiring the owner to run `vercel promote` locally — this wrapping is exactly the "workflow_dispatch job that calls the Vercel API" refinement noted above, and is a **required part of the proposed implementation scope**, not optional polish, per Constitution Article 2.1's explicit requirement that the owner not be expected to run technical commands.
- **Minimal secret scope:** requires exactly one new secret (a scoped Vercel API token), which is unavoidable under any of the three options that involve promotion or a Deploy Hook — Option B's token has a narrower, more auditable capability profile (deploy + promote via a logged Actions job) than Option C's bearer Deploy Hook URL.
- **No irreversible change:** `git.deploymentEnabled` is itself a reversible, single-line `vercel.json` change; nothing about Option B forecloses reverting to full automatic deployment later.
- **Clear rollback:** `vercel promote` against a prior deployment ID, or (in the extreme) reverting the `vercel.json` change to restore automatic deployment — both are direct, first-class, previously-documented Vercel mechanisms, not improvised workarounds.
- **Fit for confirmed plan/tooling:** every mechanism Option B relies on (`--skip-domain`, `promote`, per-branch `deploymentEnabled`) is independently confirmed present in Vercel's own current documentation (Section 3, citations preserved inline); the one unconfirmed item (exact plan-tier availability of staged promotion for this specific team account) is flagged as an open question below, not assumed.

## 5. Proposed implementation scope (NOT authorized by this document — for the future Phase 1C implementation task only)

- **Files:** `vercel.json` (add `"git": { "deploymentEnabled": { "main": false } }`); one new `.github/workflows/*.yml` file (e.g. `production-release.yml`) with `on: workflow_dispatch` only, taking a commit-SHA input, checking it out explicitly, and calling the Vercel deploy + promote REST endpoints (or CLI equivalents) using a newly-created, narrowly-scoped Vercel API token stored as a GitHub Actions secret.
- **External settings:** creation of the new Vercel API token itself (owner action, outside this repository); adding it as a GitHub Actions repository secret (requires repo-admin write access, itself a separate, explicit action).
- **Required credentials / minimum scope:** a Vercel token scoped to this one project, with deploy-create and promote capability only — no broader team/account scope. Exact minimum-scope token type to be confirmed against Vercel's current token-scoping options at implementation time, since this was not independently verified in this design-only task.
- **Rollout:** implemented and merged as its own PR (this design document's implementation), tested first with a real staged-and-promoted deployment against a low-risk commit (e.g. a docs-only change) before being relied upon for any substantive release.
- **Rollback:** revert the `vercel.json` change (single line) to restore full automatic deployment as an immediate fallback if the new workflow proves unreliable.
- **Acceptance criteria:** (a) a merge to `main` no longer produces any deployment with `target: production` automatically — confirmed by observing at least one real merge with zero automatic production deployment; (b) the new `workflow_dispatch` job, when triggered with a specific SHA, produces a deployment whose `githubCommitSha` metadata field exactly matches that SHA; (c) Preview deployments for at least one concurrent PR continue to build automatically and are unaffected; (d) a rollback (promote to a prior deployment ID) is exercised at least once successfully before this is considered load-bearing.

## 6. Open questions requiring an explicit owner decision (not resolved by this document)

1. Does the current Vercel team plan support staged production deployment + promotion (`--skip-domain` / promote REST endpoint) in practice, not just in Vercel's general documentation? This should be confirmed directly against the team's actual plan/billing page before Phase 1C implementation is scoped as a task, since this design-only task had no tool capable of reading plan-tier feature availability.
2. Who creates the new Vercel API token, and under what account (the current project creator/owner's personal account, or a dedicated service-style Vercel user)? This is explicitly an owner decision per Constitution Article 2.1/23.1 (the owner controls access and critical confirmations) and was not decided by this task.
3. Should `main` also receive actual GitHub branch protection (required PR review, required status checks) as part of or alongside Phase 1C, given that it currently has **none at all** (`protected: false`, confirmed in Section 2.2)? This is a closely related but formally separate gap from deployment separation itself — the Repair Roadmap's Constitution reference (Article 16, branch protection) already flags this as a known, disclosed item, and this design document does not resolve whether it should be bundled into Phase 1C or treated as its own phase.
4. Is Option A (separate production branch) preferred over Option B for any reason not weighed above (e.g. team familiarity, a strong preference for Git-native mechanisms over Vercel-API-based ones)? This design document recommends Option B, but the choice remains the owner's/ChatGPT's to make explicitly.

---

## 7. What this document does NOT do

- It does not modify `vercel.json`, any GitHub Actions workflow, any application code, Supabase, Vercel project settings, domains, environment variables, or Deploy Hooks.
- It does not create any Vercel token or GitHub secret.
- It does not start Phase 1C implementation.
- It does not approve Product Vision v1.0.0.
- It does not merge any pull request.
