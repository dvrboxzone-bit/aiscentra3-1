#!/usr/bin/env node
/**
 * AIscentra — API Boundary Inventory CI Check (Phase 1B)
 *
 * npm run check:api-inventory
 *
 * Validates docs/audits/api-boundary-inventory.json against the actual
 * repository state under src/app/api. Exits non-zero on any finding.
 *
 * This check does NOT declare a Security Gate PASS. rateLimit:"missing"
 * and budgetGuard:"missing" are explicitly permitted values at this phase
 * -- they represent honestly-registered technical debt, not a passing
 * security control. This script only verifies the inventory itself is
 * complete, internally consistent, and accurately reflects the current
 * routes -- nothing about the presence of an inventory entry implies the
 * underlying route is actually protected.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateInventory } from './lib/api-inventory'

const REPO_ROOT = resolve(__dirname, '..', '..')
const INVENTORY_PATH = resolve(REPO_ROOT, 'docs', 'audits', 'api-boundary-inventory.json')

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

  const result = validateInventory(REPO_ROOT, raw)

  if (result.ok) {
    console.log(
      `PASS: API boundary inventory is complete and internally consistent (${INVENTORY_PATH}).`,
    )
    console.log(
      'NOTE: this check does NOT constitute a Security Gate PASS. It verifies the inventory',
    )
    console.log(
      'itself, not that every route is actually rate-limited or budget-guarded -- see the',
    )
    console.log(
      "inventory's own rateLimit/budgetGuard fields for honestly-registered remaining debt.",
    )
    return 0
  }

  console.error(`FAIL: ${result.findings.length} finding(s) in the API boundary inventory:\n`)
  for (const finding of result.findings) {
    console.error(`  [${finding.code}] ${finding.message}`)
  }
  return 1
}

process.exit(main())
