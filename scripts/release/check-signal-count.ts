#!/usr/bin/env node
/**
 * AIscentra — CLI wrapper for checkActiveSignalCountAttribute
 *
 * Real requirement (owner directive, third architectural review):
 * "Вынеси проверку этого контракта в один общий release-скрипт и
 * используй его: в Staged smoke test; в TOCTOU re-check." One real
 * implementation (checkActiveSignalCountAttribute, domain-cutover.ts),
 * three call sites total: this CLI wrapper (invoked identically from
 * BOTH the staged-smoke and pre-promotion-recheck jobs in
 * production-release.yml) and run-domain-cutover.ts's own verifyDomain
 * (the post-cutover, live-domain check) -- never three independently
 * hand-copied checks that could drift out of sync with each other, or
 * with future page-structure changes.
 *
 * Usage: node check-signal-count.ts <htmlFilePath>
 * Prints exactly one line: "ok <count>" or "fail <reason>"
 * Exit code: 0 for ok, 1 for fail.
 */
import { readFileSync } from 'node:fs'
import { checkActiveSignalCountAttribute } from './domain-cutover'

const [, , htmlPath] = process.argv

if (!htmlPath) {
  console.log('fail no HTML file path given')
  process.exit(1)
}

let html: string
try {
  html = readFileSync(htmlPath, 'utf8')
} catch {
  console.log('fail could not read HTML file')
  process.exit(1)
}

const result = checkActiveSignalCountAttribute(html)

if (result.ok) {
  console.log(`ok ${result.count}`)
  process.exit(0)
} else {
  console.log(`fail ${result.detail ?? 'unknown'}`)
  process.exit(1)
}
