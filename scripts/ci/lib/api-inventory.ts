/**
 * AIscentra — API Boundary Inventory Validator (Phase 1B)
 *
 * Shared, testable core: filesystem scanning of src/app/api/**\/route.ts,
 * exported-method extraction, the inventory Zod schema, and the full set
 * of cross-checks between the machine-readable inventory
 * (docs/audits/api-boundary-inventory.json) and the actual repository
 * state.
 *
 * This module performs NO process.exit() and prints nothing on its own —
 * it returns a structured result. scripts/ci/check-api-inventory.ts (the
 * CLI entry point) is a thin wrapper that calls this module, prints
 * findings, and sets the process exit code. Tests import this module
 * directly against temporary fixture directories, never against the real
 * repository, and never mutate real route files.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { z } from 'zod'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export const SECURITY_CATEGORIES = [
  'public-read',
  'authenticated-user',
  'admin',
  'cron',
  'internal-machine',
  'disabled',
] as const

const PRIVILEGED_CATEGORIES = new Set<string>(['admin', 'cron', 'internal-machine'])

export const InventoryRouteSchema = z
  .object({
    path: z.string().min(1),
    file: z.string().min(1),
    methods: z.array(z.enum(HTTP_METHODS)).min(1),
    category: z.enum(SECURITY_CATEGORIES),
    guard: z.string().min(1),
    authMechanism: z.string().min(1),
    authzMechanism: z.string().min(1),
    featureFlag: z.string().min(1),
    inputValidation: z.string().min(1),
    aiCall: z.boolean(),
    serviceRole: z.boolean(),
    databaseRead: z.boolean(),
    databaseWrite: z.boolean(),
    externalNetworkCall: z.boolean(),
    costSensitive: z.boolean(),
    rateLimit: z.string().min(1),
    budgetGuard: z.string().min(1),
    publicResponseDto: z.string().min(1),
    rawErrorExposureRisk: z.string().min(1),
    productionState: z.string().min(1),
    risk: z.enum(['P0', 'P1', 'P2', 'P3']),
    notes: z.string().min(1),
  })
  .strict()

export const InventorySchema = z
  .object({
    version: z.number().int().positive(),
    baselineSha: z.string().min(1),
    generatedBy: z.string().min(1).optional(),
    routes: z.array(InventoryRouteSchema),
  })
  .strict()

export type InventoryRoute = z.infer<typeof InventoryRouteSchema>
export type Inventory = z.infer<typeof InventorySchema>

export interface Finding {
  severity: 'error'
  code: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  findings: Finding[]
}

/**
 * Recursively finds every route.ts file under apiDir, returning paths
 * relative to repoRoot using forward slashes (platform-independent),
 * e.g. "src/app/api/agent/route.ts".
 */
export function findRouteFiles(repoRoot: string, apiDirRelative = 'src/app/api'): string[] {
  const apiDir = join(repoRoot, apiDirRelative)
  const results: string[] = []

  if (!existsSync(apiDir)) return results

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (entry === 'route.ts') {
        const rel = relative(repoRoot, full).split(sep).join('/')
        results.push(rel)
      }
    }
  }

  walk(apiDir)
  return results.sort()
}

/**
 * Converts a route.ts file path (relative to repo root, forward slashes)
 * into its HTTP route path, e.g. "src/app/api/events/promote/route.ts"
 * -> "/api/events/promote".
 */
export function fileToRoutePath(file: string): string {
  const withoutPrefix = file.replace(/^src\/app/, '')
  const withoutSuffix = withoutPrefix.replace(/\/route\.ts$/, '')
  return withoutSuffix === '' ? '/' : withoutSuffix
}

export type MethodExtractionResult =
  | { ok: true; methods: HttpMethod[] }
  | { ok: false; reason: string }

/**
 * Extracts the set of exported HTTP methods from a route.ts file's source
 * text. Recognizes exactly three forms, confirmed by direct reading of
 * all 15 route.ts files in this repository during this audit:
 *
 *   export async function GET(...)   { ... }
 *   export function POST(...)        { ... }
 *   export const PUT = someHandler
 *
 * This is a regex/line-based scan, not a full TypeScript AST parse. It is
 * intentionally conservative: fail-closed, not fail-open. If a line
 * contains the word "export" together with one of the known HTTP method
 * names but does NOT match one of the three recognized forms above (for
 * example `export { GET }`, `export default function GET`, a multi-line
 * signature split across lines, or any other export style this checker
 * was not built to understand), this function returns `{ ok: false }`
 * with the offending line identified -- it never silently treats an
 * unrecognized export as "this method is not present". A caller who
 * cannot determine the true set of exported methods must not report a
 * false negative.
 */
export function extractExportedMethods(source: string): MethodExtractionResult {
  const found = new Set<HttpMethod>()
  const recognizedLineIndices = new Set<number>()
  const lines = source.split('\n')

  const patterns: RegExp[] = [
    /^export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/,
    /^export\s+function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/,
    /^export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=/,
  ]

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trimStart()
    for (const pattern of patterns) {
      const match = pattern.exec(line)
      if (match) {
        const method = match[1] as HttpMethod
        found.add(method)
        recognizedLineIndices.add(idx)
        break
      }
    }
  })

  // Fail-closed scan: any line mentioning "export" alongside a known HTTP
  // method name that was NOT already recognized above is treated as an
  // unsupported syntax, not as "no method here".
  const suspiciousPattern = /\bexport\b[^\n]*\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/
  for (let idx = 0; idx < lines.length; idx++) {
    if (recognizedLineIndices.has(idx)) continue
    const line = lines[idx]
    if (line === undefined) continue
    if (suspiciousPattern.test(line)) {
      return {
        ok: false,
        reason: `line ${idx + 1}: HTTP-method-like export does not match any recognized pattern (supported: "export async function METHOD(", "export function METHOD(", "export const METHOD ="): ${line.trim()}`,
      }
    }
  }

  return { ok: true, methods: Array.from(found).sort() }
}

/**
 * Runs the full set of cross-checks between the inventory and the actual
 * repository state under repoRoot. Does not read or write any file other
 * than route.ts files and the inventory itself (via loadInventoryFn).
 */
export function validateInventory(
  repoRoot: string,
  inventoryRaw: unknown,
  apiDirRelative = 'src/app/api',
): ValidationResult {
  const findings: Finding[] = []

  // ── Structural schema validation ────────────────────────────────────────────
  const parsed = InventorySchema.safeParse(inventoryRaw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      })
    }
    // Structural failure blocks all further cross-checks -- there is no
    // safe way to iterate `.routes` if the shape itself is wrong.
    return { ok: false, findings }
  }

  const inventory = parsed.data

  if (inventory.baselineSha.trim().length === 0) {
    findings.push({
      severity: 'error',
      code: 'EMPTY_BASELINE_SHA',
      message: 'baselineSha must not be empty',
    })
  }

  // ── Duplicate path / file detection ─────────────────────────────────────────
  const pathCounts = new Map<string, number>()
  const fileCounts = new Map<string, number>()
  for (const route of inventory.routes) {
    pathCounts.set(route.path, (pathCounts.get(route.path) ?? 0) + 1)
    fileCounts.set(route.file, (fileCounts.get(route.file) ?? 0) + 1)
  }
  for (const [path, count] of pathCounts) {
    if (count > 1)
      findings.push({
        severity: 'error',
        code: 'DUPLICATE_PATH',
        message: `path "${path}" appears ${count} times`,
      })
  }
  for (const [file, count] of fileCounts) {
    if (count > 1)
      findings.push({
        severity: 'error',
        code: 'DUPLICATE_FILE',
        message: `file "${file}" appears ${count} times`,
      })
  }

  // ── Filesystem cross-check ──────────────────────────────────────────────────
  const actualFiles = new Set(findRouteFiles(repoRoot, apiDirRelative))
  const inventoryFiles = new Set(inventory.routes.map((r) => r.file))

  for (const file of actualFiles) {
    if (!inventoryFiles.has(file)) {
      findings.push({
        severity: 'error',
        code: 'UNREGISTERED_ROUTE',
        message: `route file exists on disk but is not in the inventory: ${file}`,
      })
    }
  }
  for (const file of inventoryFiles) {
    if (!actualFiles.has(file)) {
      findings.push({
        severity: 'error',
        code: 'STALE_INVENTORY_ENTRY',
        message: `inventory references a file that no longer exists: ${file}`,
      })
    }
  }

  // ── Per-route checks (methods, guard presence, AI-call field completeness) ──
  for (const route of inventory.routes) {
    if (!actualFiles.has(route.file)) continue // already reported as STALE_INVENTORY_ENTRY

    const fullPath = join(repoRoot, route.file)
    const source = readFileSync(fullPath, 'utf8')
    const extraction = extractExportedMethods(source)

    if (!extraction.ok) {
      findings.push({
        severity: 'error',
        code: 'UNSUPPORTED_ROUTE_SYNTAX',
        message: `${route.path} (${route.file}): method extractor could not confidently determine exported methods -- ${extraction.reason}`,
      })
      continue // cannot safely compare methods without a confirmed extraction
    }

    const actualMethods = extraction.methods
    const declaredMethods = [...route.methods].sort()

    if (JSON.stringify(actualMethods) !== JSON.stringify(declaredMethods)) {
      findings.push({
        severity: 'error',
        code: 'METHOD_MISMATCH',
        message: `${route.path}: declared methods [${declaredMethods.join(', ')}] do not match actual exports [${actualMethods.join(', ')}]`,
      })
    }

    if (PRIVILEGED_CATEGORIES.has(route.category) && route.guard.trim().toLowerCase() === 'none') {
      findings.push({
        severity: 'error',
        code: 'PRIVILEGED_ROUTE_WITHOUT_GUARD',
        message: `${route.path}: category "${route.category}" requires a confirmed guard, but guard is "none"`,
      })
    }

    if (route.aiCall) {
      // rateLimit, budgetGuard, and productionState are already required
      // non-empty strings by the Zod schema (structurally impossible to
      // omit), but this explicit check gives a route-specific, readable
      // error message rather than a generic schema error if that were
      // ever to regress (e.g. via a future schema relaxation).
      for (const field of ['rateLimit', 'budgetGuard', 'productionState'] as const) {
        const value = route[field]
        if (!value || value.trim().length === 0) {
          findings.push({
            severity: 'error',
            code: 'AI_ROUTE_MISSING_SECURITY_FIELD',
            message: `${route.path}: aiCall=true but "${field}" is empty`,
          })
        }
      }
    }
  }

  return { ok: findings.length === 0, findings }
}
