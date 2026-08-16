#!/usr/bin/env node
/**
 * AIscentra — CLI wrapper for extractRealSignalPath
 *
 * Same rationale as check-signal-count.ts: ONE real implementation
 * (extractRealSignalPath, domain-cutover.ts), shared across every
 * consumer that needs a real signal detail-page path for a live check
 * -- this CLI wrapper (invoked identically from the staged-smoke and
 * pre-promotion-recheck jobs in production-release.yml) and
 * run-domain-cutover.ts's own verifyDomain (which imports the function
 * directly, not via this CLI, since it already runs as a Node process
 * with the module available).
 *
 * Usage: node extract-signal-path.ts <htmlFilePath>
 * Prints exactly one line: "ok /signals/<slug>" or "fail <reason>"
 * Exit code: 0 for ok, 1 for fail.
 */
import { readFileSync } from 'node:fs'
import { extractRealSignalPath } from './domain-cutover'

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

const path = extractRealSignalPath(html)

if (path) {
  console.log(`ok ${path}`)
  process.exit(0)
} else {
  console.log('fail no real signal detail link found')
  process.exit(1)
}
