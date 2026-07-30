/**
 * AIscentra — API Boundary Inventory Checker Tests (Phase 1B)
 *
 * Three kinds of tests:
 *
 * 1. Real repository check — validates the actual
 *    docs/audits/api-boundary-inventory.json AND the actual
 *    docs/audits/API_BOUNDARY_INVENTORY.md against the actual
 *    src/app/api tree, using the exact same validateInventory() function
 *    the CI script uses, loaded via the same file-reading path (not a
 *    pre-parsed object handed directly to Zod).
 *
 * 2. Pure-function unit tests (extractExportedMethods, fileToRoutePath,
 *    computeInventorySummary, buildMarkdownSummaryBlock) — no filesystem.
 *
 * 3. Negative scenarios — each constructs a temporary, isolated fixture
 *    directory (via mkdtempSync under the OS temp dir) with a minimal
 *    fake route.ts file and a deliberately broken inventory object, and
 *    asserts that validateInventory() reports the expected finding. No
 *    real route file under src/app/api is ever read for write, modified,
 *    or deleted by these tests -- fixtures are fully isolated temporary
 *    directories, cleaned up in afterEach.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  validateInventory,
  extractExportedMethods,
  fileToRoutePath,
  computeInventorySummary,
  buildMarkdownSummaryBlock,
  type InventoryRoute,
} from '../../../../scripts/ci/lib/api-inventory'

const REAL_REPO_ROOT = join(__dirname, '..', '..', '..', '..')

// ── Real repository check ────────────────────────────────────────────────────

describe('validateInventory — real repository', () => {
  test('the actual inventory JSON and Markdown report pass against the actual src/app/api tree, loaded via the same file-reading path as the CLI', () => {
    const inventoryPath = join(REAL_REPO_ROOT, 'docs', 'audits', 'api-boundary-inventory.json')
    const markdownPath = join(REAL_REPO_ROOT, 'docs', 'audits', 'API_BOUNDARY_INVENTORY.md')
    const raw = JSON.parse(readFileSync(inventoryPath, 'utf8'))
    const markdownText = readFileSync(markdownPath, 'utf8')
    const result = validateInventory(REAL_REPO_ROOT, raw, 'src/app/api', markdownText)
    if (!result.ok) {
      console.error('Unexpected findings against the real inventory:', result.findings)
    }
    assert.equal(result.ok, true)
    assert.equal(result.findings.length, 0)
  })
})

// ── Pure-function unit tests (no filesystem) ────────────────────────────────

describe('extractExportedMethods', () => {
  test('recognizes "export async function METHOD(" (form 1)', () => {
    const source = `export async function GET(request: Request) {}\nexport async function POST(request: Request) {}`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.methods, ['GET', 'POST'])
  })

  test('recognizes "export function METHOD(" (form 2)', () => {
    const source = `export function POST(request: Request) {}`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.methods, ['POST'])
  })

  test('recognizes "export const METHOD = handler" (form 3)', () => {
    const source = `export const GET = createAgentGetHandler()\nexport const POST = createAgentPostHandler(deps)`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.methods, ['GET', 'POST'])
  })

  test('returns ok:true with an empty array for a file with no HTTP method exports at all', () => {
    const source = `export function buildSafeAgentResponse() {}\nfunction internalHelper() {}`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(result.methods, [])
  })

  test('FAIL-CLOSED: an unrecognized export syntax mentioning a method name returns ok:false, with the offending line number and text in the reason', () => {
    // `export { GET }` is a real, valid TS re-export syntax this checker
    // does not parse -- it must not be silently treated as "GET is not
    // exported here".
    const source = `function GET(request: Request) {}\nexport { GET }`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(
        result.reason.includes('line 2'),
        `expected reason to reference line 2, got: ${result.reason}`,
      )
      assert.ok(
        result.reason.includes('export { GET }'),
        `expected reason to quote the offending line, got: ${result.reason}`,
      )
    }
  })

  test('FAIL-CLOSED: "export default function GET" is not silently treated as zero methods', () => {
    const source = `export default function GET(request: Request) {}`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(
        result.reason.includes('export default function GET'),
        `expected reason to quote the offending line, got: ${result.reason}`,
      )
    }
  })
})

describe('fileToRoutePath', () => {
  test('converts a nested route file to its path', () => {
    assert.equal(fileToRoutePath('src/app/api/events/promote/route.ts'), '/api/events/promote')
  })

  test('converts a top-level route file to its path', () => {
    assert.equal(fileToRoutePath('src/app/api/health/route.ts'), '/api/health')
  })
})

describe('computeInventorySummary / buildMarkdownSummaryBlock', () => {
  test('computes zero counts for an empty route list', () => {
    const summary = computeInventorySummary([])
    assert.equal(summary.totalRoutes, 0)
    assert.equal(summary.directAiRoutes, 0)
    assert.equal(summary.riskCounts.P0, 0)
  })

  test('buildMarkdownSummaryBlock output contains the start/end markers and every metric value', () => {
    const summary = computeInventorySummary([])
    const block = buildMarkdownSummaryBlock(summary)
    assert.ok(block.includes('API_INVENTORY_SUMMARY_START'))
    assert.ok(block.includes('API_INVENTORY_SUMMARY_END'))
    assert.ok(block.includes('| Total routes | 0 |'))
  })
})

// ── Negative scenarios — isolated temporary fixture directories ────────────────

let fixtureDir: string

function makeValidRouteFile(dir: string, relPath: string, methods: string[]): void {
  const fullDir = join(dir, relPath)
  mkdirSync(fullDir, { recursive: true })
  const exports = methods
    .map((m) => `export async function ${m}(request: Request) { return new Response('ok') }`)
    .join('\n')
  writeFileSync(join(fullDir, 'route.ts'), exports, 'utf8')
}

function baseValidRouteEntry(overrides: Partial<InventoryRoute> = {}): InventoryRoute {
  const base: InventoryRoute = {
    path: '/api/example',
    file: 'src/app/api/example/route.ts',
    methods: ['GET'],
    category: 'public-read',
    guard: 'none',
    authMechanism: 'none',
    authzMechanism: 'none',
    featureFlag: 'none',
    inputValidation: 'none',
    aiCall: false,
    aiCallMode: 'none',
    serviceRole: false,
    databaseRead: false,
    databaseWrite: false,
    externalNetworkCall: false,
    costSensitive: false,
    weakSharedSecret: false,
    hasCallerFacingRateLimit: false,
    rateLimit: 'missing',
    budgetGuard: 'n/a',
    publicResponseDto: 'plain text',
    rawErrorExposureRisk: 'none',
    productionState: 'enabled',
    risk: 'P3',
    notes: 'fixture route for testing',
  }
  return { ...base, ...overrides }
}

/** Builds a full inventory object with a correctly auto-computed summary, so most fixture tests don't need to hand-compute it. */
function makeInventory(
  routes: InventoryRoute[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    baselineSha: 'abc123',
    routes,
    summary: computeInventorySummary(routes),
    ...overrides,
  }
}

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'aiscentra-inventory-fixture-'))
})

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
})

describe('validateInventory — negative scenarios (isolated fixtures)', () => {
  test('1. a real inventory matching a real fixture tree passes', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const inventory = makeInventory([baseValidRouteEntry()])
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, true, JSON.stringify(result.findings))
  })

  test('2. a new unregistered route on disk causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    makeValidRouteFile(fixtureDir, 'src/app/api/unregistered', ['POST'])
    const inventory = makeInventory([baseValidRouteEntry()])
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'UNREGISTERED_ROUTE'))
  })

  test('3. a removed route still present in the inventory causes FAIL', () => {
    const inventory = makeInventory([baseValidRouteEntry()])
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'STALE_INVENTORY_ENTRY'))
  })

  test('4. a duplicate path causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    makeValidRouteFile(fixtureDir, 'src/app/api/example2', ['GET'])
    const routes = [
      baseValidRouteEntry(),
      baseValidRouteEntry({ path: '/api/example', file: 'src/app/api/example2/route.ts' }),
    ]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'DUPLICATE_PATH'))
  })

  test('5. a duplicate file causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [baseValidRouteEntry(), baseValidRouteEntry({ path: '/api/example-alias' })]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'DUPLICATE_FILE'))
  })

  test('6. an unknown category value causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [
      baseValidRouteEntry({
        category: 'totally-not-a-real-category' as InventoryRoute['category'],
      }),
    ]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'SCHEMA_INVALID'))
  })

  test('7. a mismatched HTTP method causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET', 'POST'])
    const routes = [baseValidRouteEntry({ methods: ['GET'] })] // file actually exports GET+POST
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'METHOD_MISMATCH'))
  })

  test('8. a privileged category without a confirmed guard causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [baseValidRouteEntry({ category: 'admin', guard: 'none' })]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'PRIVILEGED_ROUTE_WITHOUT_GUARD'))
  })

  test('9. an AI-call route with an empty security field causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [
      baseValidRouteEntry({
        aiCall: true,
        aiCallMode: 'direct',
        costSensitive: true,
        externalNetworkCall: true,
        rateLimit: '',
      }),
    ]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(
      result.findings.some((f) => f.code === 'SCHEMA_INVALID' && f.message.includes('rateLimit')),
    )
  })

  test('10. actual malformed JSON text, loaded through the same file-reading path as the CLI, causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const inventoryPath = join(fixtureDir, 'inventory.json')
    writeFileSync(inventoryPath, '{ this is not valid json', 'utf8')

    let parseError: unknown = null
    let raw: unknown = undefined
    try {
      const text = readFileSync(inventoryPath, 'utf8')
      raw = JSON.parse(text)
    } catch (err) {
      parseError = err
    }

    // This mirrors exactly what check-api-inventory.ts does: JSON.parse
    // throws before validateInventory is ever called. The CLI's own
    // catch block is what turns this into exit code 1 -- we assert that
    // the same failure happens at the same file-loading step, not that
    // validateInventory somehow rejects an already-valid JS object.
    assert.ok(parseError instanceof Error, 'JSON.parse must throw on malformed JSON text')
    assert.equal(raw, undefined)
  })

  test('11. a route file with unrecognized export syntax causes FAIL via UNSUPPORTED_ROUTE_SYNTAX, not a false METHOD_MISMATCH', () => {
    const dir = join(fixtureDir, 'src/app/api/example')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'route.ts'),
      `function GET(request: Request) {}\nexport { GET }`,
      'utf8',
    )
    const routes = [baseValidRouteEntry()]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'UNSUPPORTED_ROUTE_SYNTAX'))
    assert.equal(
      result.findings.some((f) => f.code === 'METHOD_MISMATCH'),
      false,
      'an unsupported-syntax file must not also be silently scored as a method mismatch',
    )
  })

  test('12. path/file mismatch causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [baseValidRouteEntry({ path: '/api/wrong' })] // file is src/app/api/example/route.ts
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    const finding = result.findings.find((f) => f.code === 'PATH_FILE_MISMATCH')
    assert.ok(finding, 'expected a PATH_FILE_MISMATCH finding')
    assert.ok(finding.message.includes('/api/wrong'))
    assert.ok(finding.message.includes('/api/example'))
    assert.ok(finding.message.includes('src/app/api/example/route.ts'))
  })

  test('13. summary mismatch (hand-edited number not matching routes) causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [baseValidRouteEntry()]
    const inventory = makeInventory(routes)
    // Corrupt one summary number by hand, simulating a manual edit that
    // was never regenerated from the routes array.
    const summary = inventory['summary'] as Record<string, unknown>
    summary['totalRoutes'] = 999
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'SUMMARY_MISMATCH'))
  })

  test('14. Markdown summary block mismatch (one number hand-edited) causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [baseValidRouteEntry()]
    const inventory = makeInventory(routes)
    const summary = computeInventorySummary(routes)
    const correctBlock = buildMarkdownSummaryBlock(summary)
    // Hand-edit one number in the otherwise-correct block.
    const corruptedBlock = correctBlock.replace('| Total routes | 1 |', '| Total routes | 42 |')
    const markdownText = `# Fixture report\n\n${corruptedBlock}\n`
    const result = validateInventory(fixtureDir, inventory, 'src/app/api', markdownText)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'MARKDOWN_SUMMARY_MISMATCH'))
  })

  test('15. Markdown summary block missing entirely causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [baseValidRouteEntry()]
    const inventory = makeInventory(routes)
    const result = validateInventory(
      fixtureDir,
      inventory,
      'src/app/api',
      '# Fixture report with no summary block',
    )
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'MARKDOWN_SUMMARY_BLOCK_MISSING'))
  })

  test('16. a correctly regenerated Markdown summary block passes', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [baseValidRouteEntry()]
    const inventory = makeInventory(routes)
    const summary = computeInventorySummary(routes)
    const block = buildMarkdownSummaryBlock(summary)
    const markdownText = `# Fixture report\n\n${block}\n`
    const result = validateInventory(fixtureDir, inventory, 'src/app/api', markdownText)
    assert.equal(result.ok, true, JSON.stringify(result.findings))
  })

  test('17. direct AI call with costSensitive=false causes FAIL (AI/network consistency)', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [
      baseValidRouteEntry({
        aiCall: true,
        aiCallMode: 'direct',
        costSensitive: false,
        externalNetworkCall: true,
      }),
    ]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'AI_ROUTE_NOT_COST_SENSITIVE'))
  })

  test('18. direct AI call with externalNetworkCall=false causes FAIL (AI/network consistency)', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [
      baseValidRouteEntry({
        aiCall: true,
        aiCallMode: 'direct',
        costSensitive: true,
        externalNetworkCall: false,
      }),
    ]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'AI_ROUTE_NOT_EXTERNAL_NETWORK'))
  })

  test('19. indirect AI trigger with costSensitive=false causes FAIL (orchestrator consistency)', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [
      baseValidRouteEntry({
        aiCall: true,
        aiCallMode: 'indirect',
        costSensitive: false,
        externalNetworkCall: true,
      }),
    ]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'AI_ROUTE_NOT_COST_SENSITIVE'))
  })

  test('20. aiCall boolean disagreeing with aiCallMode causes FAIL', () => {
    makeValidRouteFile(fixtureDir, 'src/app/api/example', ['GET'])
    const routes = [
      baseValidRouteEntry({
        aiCall: false,
        aiCallMode: 'direct',
        costSensitive: true,
        externalNetworkCall: true,
      }),
    ]
    const result = validateInventory(fixtureDir, makeInventory(routes))
    assert.equal(result.ok, false)
    assert.ok(
      result.findings.some((f) => f.code === 'SCHEMA_INVALID' && f.message.includes('aiCall')),
    )
  })
})
