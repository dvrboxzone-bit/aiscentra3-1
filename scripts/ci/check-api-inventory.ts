#!/usr/bin/env node
/**
 * AIscentra — API Boundary Inventory CI Check (Phase 1B)
 *
 * npm run check:api-inventory
 *
 * Validates docs/audits/api-boundary-inventory.json against the actual
 * repository state under src/app/api, and validates the Markdown report's
 * machine-owned summary block against the JSON. Exits non-zero on any
 * finding.
 *
 * This check does NOT declare a Security Gate PASS. rateLimit:"missing"
 * and budgetGuard:"missing" are explicitly permitted values at this phase
 * -- they represent honestly-registered technical debt, not a passing
 * security control. This script verifies the inventory is structurally
 * complete, path/file/method aligned, and summary-consistent. It does NOT
 * verify that the security-property fields themselves (aiCall,
 * serviceRole, databaseRead/Write, rawErrorExposureRisk,
 * weakSharedSecret, etc.) accurately describe the route's real runtime
 * behavior -- those remain manually audited (see
 * docs/audits/API_BOUNDARY_INVENTORY.md), and this check only verifies
 * they are internally consistent with each other, never against actual
 * execution.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateInventory } from './lib/api-inventory'

const REPO_ROOT = resolve(__dirname, '..', '..')
const INVENTORY_PATH = resolve(REPO_ROOT, 'docs', 'audits', 'api-boundary-inventory.json')
const MARKDOWN_PATH = resolve(REPO_ROOT, 'docs', 'audits', 'API_BOUNDARY_INVENTORY.md')

function main(): number {
  let raw: unknown
  try {
    const text = readFileSync(INVENTORY_PATH, 'utf8')
    raw = JSON.parse(text)
  } catch (err) {
    console.error(`FATAL: could not read or parse ${INVENTORY_PATH}`)
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  let markdownText: string
  try {
    markdownText = readFileSync(MARKDOWN_PATH, 'utf8')
  } catch (err) {
    console.error(`FATAL: could not read ${MARKDOWN_PATH}`)
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  const result = validateInventory(REPO_ROOT, raw, 'src/app/api', markdownText)

  if (result.ok) {
    console.log(`PASS: API boundary inventory is ${INVENTORY_PATH}`)
    console.log('structurally complete, path/file/method aligned, and summary-consistent;')
    console.log('security-property fields remain manually audited unless an explicit')
    console.log('machine consistency rule is listed.')
    console.log('This does NOT constitute a Security Gate PASS.')
    return 0
  }

  console.error(`FAIL: ${result.findings.length} finding(s) in the API boundary inventory:\n`)
  for (const finding of result.findings) {
    console.error(`  [${finding.code}] ${finding.message}`)
  }
  return 1
}

process.exit(main())
