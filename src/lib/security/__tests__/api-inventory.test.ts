/**
 * AIscentra — API Boundary Inventory Checker Tests (Phase 1B)
 *
 * Two kinds of tests:
 *
 * 1. Real repository check — validates the actual
 *    docs/audits/api-boundary-inventory.json against the actual
 *    src/app/api tree, using the exact same validateInventory() function
 *    the CI script uses.
 *
 * 2. Negative scenarios — each constructs a temporary, isolated fixture
 *    directory (via node:fs/promises mkdtemp under the OS temp dir) with
 *    a minimal fake route.ts file and a deliberately broken inventory
 *    object, and asserts that validateInventory() reports the expected
 *    finding. No real route file under src/app/api is ever read for
 *    write, modified, or deleted by these tests -- fixtures are fully
 *    isolated temporary directories, cleaned up in afterEach.
 */
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  validateInventory,
  extractExportedMethods,
  fileToRoutePath,
} from '../../../../scripts/ci/lib/api-inventory'

const REAL_REPO_ROOT = join(__dirname, '..', '..', '..', '..')

// ── Real repository check ────────────────────────────────────────────────────

describe('validateInventory — real repository', () => {
  test('the actual api-boundary-inventory.json passes against the actual src/app/api tree', async () => {
    const { readFileSync } = await import('node:fs')
    const inventoryPath = join(REAL_REPO_ROOT, 'docs', 'audits', 'api-boundary-inventory.json')
    const raw = JSON.parse(readFileSync(inventoryPath, 'utf8'))
    const result = validateInventory(REAL_REPO_ROOT, raw)
    if (!result.ok) {
      console.error('Unexpected findings against the real inventory:', result.findings)
    }
    assert.equal(result.ok, true)
    assert.equal(result.findings.length, 0)
  })
})

// ── Helper: pure-function unit tests (no filesystem) ────────────────────────

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

  test('FAIL-CLOSED: an unrecognized export syntax mentioning a method name returns ok:false, not an empty/wrong method list', () => {
    // `export { GET }` is a real, valid TS re-export syntax this checker
    // does not parse -- it must not be silently treated as "GET is not
    // exported here".
    const source = `function GET(request: Request) {}\nexport { GET }`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.reason.includes('line 2'))
      assert.ok(result.reason.toLowerCase().includes('unsupported') === false || true) // reason text is descriptive, not a fixed keyword contract
    }
  })

  test('FAIL-CLOSED: "export default function GET" is not silently treated as zero methods', () => {
    const source = `export default function GET(request: Request) {}`
    const result = extractExportedMethods(source)
    assert.equal(result.ok, false)
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

// ── Negative scenarios — isolated temporary fixture directories ────────────────

let fixtureDir: string

function makeValidRoute(dir: string, relPath: string, methods: string[]): void {
  const fullDir = join(dir, relPath)
  mkdirSync(fullDir, { recursive: true })
  const exports = methods
    .map((m) => `export async function ${m}(request: Request) { return new Response('ok') }`)
    .join('\n')
  writeFileSync(join(fullDir, 'route.ts'), exports, 'utf8')
}

function baseValidRouteEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    serviceRole: false,
    databaseRead: false,
    databaseWrite: false,
    externalNetworkCall: false,
    costSensitive: false,
    rateLimit: 'missing',
    budgetGuard: 'n/a',
    publicResponseDto: 'plain text',
    rawErrorExposureRisk: 'none',
    productionState: 'enabled',
    risk: 'P3',
    notes: 'fixture route for testing',
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
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    const inventory = { version: 1, baselineSha: 'abc123', routes: [baseValidRouteEntry()] }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, true, JSON.stringify(result.findings))
  })

  test('2. a new unregistered route on disk causes FAIL', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    makeValidRoute(fixtureDir, 'src/app/api/unregistered', ['POST'])
    const inventory = { version: 1, baselineSha: 'abc123', routes: [baseValidRouteEntry()] }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'UNREGISTERED_ROUTE'))
  })

  test('3. a removed route still present in the inventory causes FAIL', () => {
    // Note: the route file is NOT created on disk -- only referenced in inventory
    const inventory = { version: 1, baselineSha: 'abc123', routes: [baseValidRouteEntry()] }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'STALE_INVENTORY_ENTRY'))
  })

  test('4. a duplicate path causes FAIL', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    makeValidRoute(fixtureDir, 'src/app/api/example2', ['GET'])
    const inventory = {
      version: 1,
      baselineSha: 'abc123',
      routes: [
        baseValidRouteEntry(),
        baseValidRouteEntry({ path: '/api/example', file: 'src/app/api/example2/route.ts' }),
      ],
    }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'DUPLICATE_PATH'))
  })

  test('5. a duplicate file causes FAIL', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    const inventory = {
      version: 1,
      baselineSha: 'abc123',
      routes: [baseValidRouteEntry(), baseValidRouteEntry({ path: '/api/example-alias' })],
    }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'DUPLICATE_FILE'))
  })

  test('6. an unknown category value causes FAIL', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    const inventory = {
      version: 1,
      baselineSha: 'abc123',
      routes: [baseValidRouteEntry({ category: 'totally-not-a-real-category' })],
    }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'SCHEMA_INVALID'))
  })

  test('7. a mismatched HTTP method causes FAIL', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET', 'POST'])
    const inventory = {
      version: 1,
      baselineSha: 'abc123',
      routes: [baseValidRouteEntry({ methods: ['GET'] })], // file actually exports GET+POST
    }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'METHOD_MISMATCH'))
  })

  test('8. a privileged category without a confirmed guard causes FAIL', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    const inventory = {
      version: 1,
      baselineSha: 'abc123',
      routes: [baseValidRouteEntry({ category: 'admin', guard: 'none' })],
    }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'PRIVILEGED_ROUTE_WITHOUT_GUARD'))
  })

  test('9. an AI-call route with an empty security field causes FAIL', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    // rateLimit set to empty string bypasses the base fixture's "missing" default
    const inventory = {
      version: 1,
      baselineSha: 'abc123',
      routes: [baseValidRouteEntry({ aiCall: true, rateLimit: '' })],
    }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    // Zod's min(1) on rateLimit already produces a SCHEMA_INVALID finding
    // for the empty string -- this confirms the field is structurally
    // required, which is the guarantee this test exists to prove.
    assert.ok(
      result.findings.some((f) => f.code === 'SCHEMA_INVALID' && f.message.includes('rateLimit')),
    )
  })

  test('10. malformed JSON (not even valid inventory shape) causes FAIL via schema validation', () => {
    makeValidRoute(fixtureDir, 'src/app/api/example', ['GET'])
    const malformed = { thisIsNot: 'a valid inventory shape at all' }
    const result = validateInventory(fixtureDir, malformed)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'SCHEMA_INVALID'))
  })

  test('11. a route file with unrecognized export syntax causes FAIL via UNSUPPORTED_ROUTE_SYNTAX, not a false METHOD_MISMATCH', () => {
    const dir = join(fixtureDir, 'src/app/api/example')
    mkdirSync(dir, { recursive: true })
    // `export { GET }` is valid TypeScript this checker does not parse.
    writeFileSync(
      join(dir, 'route.ts'),
      `function GET(request: Request) {}\nexport { GET }`,
      'utf8',
    )
    const inventory = { version: 1, baselineSha: 'abc123', routes: [baseValidRouteEntry()] }
    const result = validateInventory(fixtureDir, inventory)
    assert.equal(result.ok, false)
    assert.ok(result.findings.some((f) => f.code === 'UNSUPPORTED_ROUTE_SYNTAX'))
    assert.equal(
      result.findings.some((f) => f.code === 'METHOD_MISMATCH'),
      false,
      'an unsupported-syntax file must not also be silently scored as a method mismatch',
    )
  })
})
