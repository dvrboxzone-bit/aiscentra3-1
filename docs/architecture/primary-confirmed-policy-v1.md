# PRIMARY_CONFIRMED policy V1

`primary-confirmed-v1` is an explicit, append-only source-policy contract for a
new Durable SIS `SIGNAL`. It permits a bounded primary claim to move from
`DRAFT/PENDING` to `ACTIVE/APPROVED` while keeping verification state
`SINGLE_SOURCE_UNVERIFIED`. It never represents independent verification.

## Registered sources and claim scopes

| Source            | Class               | V1 decision | Bounded claim scope                                                                              | Required public attribution |
| ----------------- | ------------------- | ----------- | ------------------------------------------------------------------------------------------------ | --------------------------- |
| OpenAI Blog       | `OFFICIAL_ISSUER`   | allow       | OpenAI statements about its own products, availability, policy, safety, and release materials    | `OpenAI announced`          |
| Google DeepMind   | `OFFICIAL_ISSUER`   | allow       | Google DeepMind statements about its own announcements, models, research artifacts, and releases | `Google DeepMind announced` |
| ArXiv CS.AI       | `SCHOLARLY_PRIMARY` | allow       | exact preprint publication and results self-reported by its authors                              | `The authors report`        |
| ArXiv CS.LG       | `SCHOLARLY_PRIMARY` | allow       | exact preprint publication and results self-reported by its authors                              | `The authors report`        |
| GitHub Blog       | `EXCLUDE`           | deny        | none                                                                                             | none                        |
| Hugging Face Blog | `EXCLUDE`           | deny        | none                                                                                             | none                        |

OpenAI and DeepMind evidence does not establish independent effectiveness,
safety, adoption, superiority, replication, or impact. ArXiv evidence does not
establish replication. CS.AI and CS.LG share provenance root `arxiv.org`; an
exact paper ID is recorded as one author-origin artifact, so cross-listing cannot
add independence credit.

## Runtime contract

Only a new Durable SIS run in `READY_TO_FINALIZE` with outcome `SIGNAL` can invoke
the transition. Existing SIS, qualification, anti-hype, URL-verification,
duplicate, kill-switch, and provider-budget guards remain unchanged. Source ID and
the exact registered source URL must match the versioned database rule; hostname,
title, trust score, marketing text, or model output cannot grant eligibility.

The finalization transaction inserts an append-only allow/deny audit containing
the policy version, observation, source, run, origin owner, provenance root, claim
scope, prohibited claims, attribution, actor, runtime, timestamp, and exact reason.
An approved result atomically becomes `PRIMARY_CONFIRMED`, `APPROVED`, and
`ACTIVE`. A policy rejection remains `DRAFT/PENDING`. Any SQL failure rolls back
the Signal, audit, content decision, observation update, finalization record, and
queue archive; redelivery is idempotent.

`WEAK`, `ARCHIVE`, insufficient-SIS, excluded-source, legacy, and malformed-source
records are not promoted. The existing independently corroborated path remains a
separate operation and evidence tier. No scheduler, public endpoint, replay,
provider call, email send, or legacy backfill is introduced by this contract.
