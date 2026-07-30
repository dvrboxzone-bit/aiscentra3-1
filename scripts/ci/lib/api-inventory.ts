/**
 * AIscentra — API Boundary Inventory Validator (Phase 1B)
 *
 * Shared, testable core: filesystem scanning of src/app/api/**\/route.ts,
 * exported-method extraction, the inventory Zod schema, computed summary
 * derivation, and the full set of cross-checks between the
 * machine-readable inventory (docs/audits/api-boundary-inventory.json)
 * and the actual repository state.
 *
 * IMPORTANT SCOPE NOTE: this validator is structurally complete,
 * path/file/method aligned, and summary-consistent -- it is NOT a claim
 * that it "accurately reflects the current routes" in the sense of
 * verifying security properties. Fields such as aiCall, aiCallMode,
 * serviceRole, databaseRead/Write, rawErrorExposureRisk, and
 * weakSharedSecret are populated from manual code review (see
 * docs/audits/API_BOUNDARY_INVENTORY.md for the explicit machine-vs-manual
 * split) and are only checked here for INTERNAL CONSISTENCY against each
 * other (e.g. "direct AI call implies costSensitive=true"), never against
 * the actual route source code's runtime behavior -- this module has no
 * way to execute a route or trace its real network calls.
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

export const AI_CALL_MODES = ['none', 'direct', 'indirect', 'direct-and-indirect'] as const
export type AiCallMode = (typeof AI_CALL_MODES)[number]

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
    aiCallMode: z.enum(AI_CALL_MODES),
    serviceRole: z.boolean(),
    databaseRead: z.boolean(),
    databaseWrite: z.boolean(),
    externalNetworkCall: z.boolean(),
    costSensitive: z.boolean(),
    weakSharedSecret: z.boolean(),
    hasCallerFacingRateLimit: z.boolean(),
    rateLimit: z.string().min(1),
    budgetGuard: z.string().min(1),
    publicResponseDto: z.string().min(1),
    rawErrorExposureRisk: z.string().min(1),
    productionState: z.string().min(1),
    risk: z.enum(['P0', 'P1', 'P2', 'P3']),
    notes: z.string().min(1),
  })
  .strict()
  .refine((route) => route.aiCall === (route.aiCallMode !== 'none'), {
    message: 'aiCall must equal (aiCallMode !== "none")',
    path: ['aiCall'],
  })

export const InventorySummarySchema = z
  .object({
    totalRoutes: z.number().int().nonnegative(),
    categoryCounts: z.record(z.string(), z.number().int().nonnegative()),
    directAiRoutes: z.number().int().nonnegative(),
    indirectAiRoutes: z.number().int().nonnegative(),
    serviceRoleRoutes: z.number().int().nonnegative(),
    databaseReadRoutes: z.number().int().nonnegative(),
    databaseWriteRoutes: z.number().int().nonnegative(),
    rateLimitMissingLiteralCount: z.number().int().nonnegative(),
    routesWithoutRealCallerFacingRateLimit: z.number().int().nonnegative(),
    budgetGuardMissingLiteralCount: z.number().int().nonnegative(),
    costSensitiveRoutes: z.number().int().nonnegative(),
    externalNetworkRoutes: z.number().int().nonnegative(),
    weakSharedSecretRoutes: z.number().int().nonnegative(),
    confirmedRawErrorRoutes: z.number().int().nonnegative(),
    riskCounts: z.object({
      P0: z.number().int().nonnegative(),
      P1: z.number().int().nonnegative(),
      P2: z.number().int().nonnegative(),
      P3: z.number().int().nonnegative(),
    }),
  })
  .strict()

export const InventorySchema = z
  .object({
    version: z.number().int().positive(),
    baselineSha: z.string().min(1),
    generatedBy: z.string().min(1).optional(),
    routes: z.array(InventoryRouteSchema),
    summary: InventorySummarySchema,
  })
  .strict()

export type InventoryRoute = z.infer<typeof InventoryRouteSchema>
export type InventorySummary = z.infer<typeof InventorySummarySchema>
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

// ── Filesystem scanning ─────────────────────────────────────────────────────────

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

export function fileToRoutePath(file: string): string {
  const withoutPrefix = file.replace(/^src\/app/, '')
  const withoutSuffix = withoutPrefix.replace(/\/route\.ts$/, '')
  return withoutSuffix === '' ? '/' : withoutSuffix
}

export type MethodExtractionResult =
  | { ok: true; methods: HttpMethod[] }
  | { ok: false; reason: string }

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

// ── Computed summary ────────────────────────────────────────────────────────────

export function computeInventorySummary(routes: InventoryRoute[]): InventorySummary {
  const categoryCounts: Record<string, number> = {}
  for (const category of SECURITY_CATEGORIES) categoryCounts[category] = 0
  for (const route of routes) {
    categoryCounts[route.category] = (categoryCounts[route.category] ?? 0) + 1
  }

  const riskCounts = { P0: 0, P1: 0, P2: 0, P3: 0 }
  for (const route of routes) riskCounts[route.risk]++

  return {
    totalRoutes: routes.length,
    categoryCounts,
    directAiRoutes: routes.filter(
      (r) => r.aiCallMode === 'direct' || r.aiCallMode === 'direct-and-indirect',
    ).length,
    indirectAiRoutes: routes.filter(
      (r) => r.aiCallMode === 'indirect' || r.aiCallMode === 'direct-and-indirect',
    ).length,
    serviceRoleRoutes: routes.filter((r) => r.serviceRole).length,
    databaseReadRoutes: routes.filter((r) => r.databaseRead).length,
    databaseWriteRoutes: routes.filter((r) => r.databaseWrite).length,
    rateLimitMissingLiteralCount: routes.filter((r) => r.rateLimit === 'missing').length,
    routesWithoutRealCallerFacingRateLimit: routes.filter((r) => !r.hasCallerFacingRateLimit)
      .length,
    budgetGuardMissingLiteralCount: routes.filter((r) => r.budgetGuard === 'missing').length,
    costSensitiveRoutes: routes.filter((r) => r.costSensitive).length,
    externalNetworkRoutes: routes.filter((r) => r.externalNetworkCall).length,
    weakSharedSecretRoutes: routes.filter((r) => r.weakSharedSecret).length,
    confirmedRawErrorRoutes: routes.filter((r) =>
      r.rawErrorExposureRisk.trim().toUpperCase().startsWith('YES'),
    ).length,
    riskCounts,
  }
}

function summariesEqual(a: InventorySummary, b: InventorySummary): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ── Markdown machine-owned summary block ────────────────────────────────────────

export const MARKDOWN_SUMMARY_START = '<!-- API_INVENTORY_SUMMARY_START -->'
export const MARKDOWN_SUMMARY_END = '<!-- API_INVENTORY_SUMMARY_END -->'

export function buildMarkdownSummaryBlock(summary: InventorySummary): string {
  const lines: string[] = [MARKDOWN_SUMMARY_START, '', '| Metric | Value |', '|---|---:|']
  lines.push(`| Total routes | ${summary.totalRoutes} |`)
  for (const category of SECURITY_CATEGORIES) {
    lines.push(`| Category: \`${category}\` | ${summary.categoryCounts[category] ?? 0} |`)
  }
  lines.push(`| Direct AI-calling routes | ${summary.directAiRoutes} |`)
  lines.push(`| Indirect AI-triggering routes | ${summary.indirectAiRoutes} |`)
  lines.push(`| Service-role routes | ${summary.serviceRoleRoutes} |`)
  lines.push(`| Database-read routes | ${summary.databaseReadRoutes} |`)
  lines.push(`| Database-write routes | ${summary.databaseWriteRoutes} |`)
  lines.push(`| Literal rateLimit="missing" count | ${summary.rateLimitMissingLiteralCount} |`)
  lines.push(
    `| Routes without a real caller-facing HTTP rate limit | ${summary.routesWithoutRealCallerFacingRateLimit} |`,
  )
  lines.push(`| Literal budgetGuard="missing" count | ${summary.budgetGuardMissingLiteralCount} |`)
  lines.push(`| Cost-sensitive routes | ${summary.costSensitiveRoutes} |`)
  lines.push(`| External-network-call routes | ${summary.externalNetworkRoutes} |`)
  lines.push(
    `| Weak shared-secret (non-constant-time) routes | ${summary.weakSharedSecretRoutes} |`,
  )
  lines.push(`| Confirmed raw-error-exposure routes | ${summary.confirmedRawErrorRoutes} |`)
  lines.push(`| Risk: P0 | ${summary.riskCounts.P0} |`)
  lines.push(`| Risk: P1 | ${summary.riskCounts.P1} |`)
  lines.push(`| Risk: P2 | ${summary.riskCounts.P2} |`)
  lines.push(`| Risk: P3 | ${summary.riskCounts.P3} |`)
  lines.push('', MARKDOWN_SUMMARY_END)
  return lines.join('\n')
}

function extractMarkdownSummaryBlock(markdown: string): string | null {
  const startIdx = markdown.indexOf(MARKDOWN_SUMMARY_START)
  const endIdx = markdown.indexOf(MARKDOWN_SUMMARY_END)
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null
  return markdown.slice(startIdx, endIdx + MARKDOWN_SUMMARY_END.length)
}

function normalizeForComparison(text: string): string {
  // Prettier reformats Markdown tables: it pads cell content with spaces
  // for column alignment, AND widens the header-separator row's dashes
  // (`---`) to match the widest cell in that column. Both are purely
  // cosmetic and must not cause a false MARKDOWN_SUMMARY_MISMATCH.
  // Stripping all whitespace and collapsing any run of 2+ dashes to a
  // single dash is safe for this specific machine-generated table's
  // content (numbers and fixed metric/category labels never contain a
  // meaningful multi-dash run) -- a changed number or a missing row
  // still changes the resulting string.
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, '').replace(/-{2,}/g, '-'))
    .join('\n')
    .trim()
}

// ── AI/network/cost consistency rules ───────────────────────────────────────────

function checkAiNetworkCostConsistency(route: InventoryRoute): Finding[] {
  const findings: Finding[] = []
  const hasAi =
    route.aiCallMode === 'direct' ||
    route.aiCallMode === 'indirect' ||
    route.aiCallMode === 'direct-and-indirect'

  if (hasAi && !route.costSensitive) {
    findings.push({
      severity: 'error',
      code: 'AI_ROUTE_NOT_COST_SENSITIVE',
      message: `${route.path}: aiCallMode="${route.aiCallMode}" requires costSensitive=true (direct or indirect AI exposure is always cost-sensitive)`,
    })
  }

  if (hasAi && !route.externalNetworkCall) {
    findings.push({
      severity: 'error',
      code: 'AI_ROUTE_NOT_EXTERNAL_NETWORK',
      message: `${route.path}: aiCallMode="${route.aiCallMode}" requires externalNetworkCall=true (an AI provider call, direct or via a triggered sub-request, is always an external network call)`,
    })
  }

  return findings
}

// ── Main validation entry point ─────────────────────────────────────────────────

export function validateInventory(
  repoRoot: string,
  inventoryRaw: unknown,
  apiDirRelative = 'src/app/api',
  markdownText?: string,
): ValidationResult {
  const findings: Finding[] = []

  const parsed = InventorySchema.safeParse(inventoryRaw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push({
        severity: 'error',
        code: 'SCHEMA_INVALID',
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      })
    }
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

  for (const route of inventory.routes) {
    const expectedPath = fileToRoutePath(route.file)
    if (route.path !== expectedPath) {
      findings.push({
        severity: 'error',
        code: 'PATH_FILE_MISMATCH',
        message: `declared path "${route.path}" does not match the path derived from file "${route.file}" (expected "${expectedPath}")`,
      })
    }

    findings.push(...checkAiNetworkCostConsistency(route))

    if (!actualFiles.has(route.file)) continue

    const fullPath = join(repoRoot, route.file)
    const source = readFileSync(fullPath, 'utf8')
    const extraction = extractExportedMethods(source)

    if (!extraction.ok) {
      findings.push({
        severity: 'error',
        code: 'UNSUPPORTED_ROUTE_SYNTAX',
        message: `${route.path} (${route.file}): method extractor could not confidently determine exported methods -- ${extraction.reason}`,
      })
      continue
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

  const recomputedSummary = computeInventorySummary(inventory.routes)
  if (!summariesEqual(inventory.summary, recomputedSummary)) {
    findings.push({
      severity: 'error',
      code: 'SUMMARY_MISMATCH',
      message: `inventory.summary does not match the recomputed summary from routes. Recomputed: ${JSON.stringify(recomputedSummary)}`,
    })
  }

  if (markdownText !== undefined) {
    const expectedBlock = buildMarkdownSummaryBlock(recomputedSummary)
    const actualBlock = extractMarkdownSummaryBlock(markdownText)
    if (actualBlock === null) {
      findings.push({
        severity: 'error',
        code: 'MARKDOWN_SUMMARY_BLOCK_MISSING',
        message: `Markdown report is missing the machine-owned summary block between ${MARKDOWN_SUMMARY_START} and ${MARKDOWN_SUMMARY_END}`,
      })
    } else if (normalizeForComparison(actualBlock) !== normalizeForComparison(expectedBlock)) {
      findings.push({
        severity: 'error',
        code: 'MARKDOWN_SUMMARY_MISMATCH',
        message: `Markdown machine-owned summary block does not match the block computed from the JSON inventory. Expected:\n${expectedBlock}`,
      })
    }
  }

  return { ok: findings.length === 0, findings }
}
