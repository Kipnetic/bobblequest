#!/usr/bin/env bun
/**
 * Dependency audit gate for the CI Gate `verify` job.
 *
 * Runs `bun audit --json`, subtracts reviewed, time-boxed exceptions from
 * `.github/dependency-audit-exceptions.json`, and fails when anything is left.
 *
 * Policy (docs/security/dependency-audit-policy.md):
 * - Default: zero residual advisories, every severity.
 * - Fix first: compatible bumps, then bounded `overrides`, then major upgrades.
 * - An exception names one GHSA/CVE id, an owner, a reason and an expiry at
 *   most 90 days out. Expired exceptions that still match fail the gate.
 * - The gate fails closed: an audit that errors without a parseable report,
 *   or an invalid exception file, is a failure, never a pass.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type AuditAdvisory = {
  id: string
  packageName: string
  severity: string
  title: string
  url: string
  vulnerableVersions?: string
}

export type AuditException = {
  /** GHSA-… or CVE-… (case-insensitive). */
  id: string
  reason: string
  owner: string
  /** YYYY-MM-DD (UTC day), at most MAX_EXCEPTION_DAYS from today. */
  expires: string
  package?: string
  review_url?: string
}

export const MAX_EXCEPTION_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
  info: 0,
}

export function normalizeAdvisoryId(raw: string): string {
  return raw.trim().toUpperCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse the `bun audit --json` map: { [packageName]: Advisory[] }.
 *
 * An entry with no usable id is kept as `UNIDENTIFIED`, which no exception
 * can match, so a malformed report fails the gate instead of dropping it.
 */
export function parseBunAuditJson(raw: unknown): AuditAdvisory[] {
  if (!isRecord(raw)) return []

  const out: AuditAdvisory[] = []
  for (const [packageName, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (!isRecord(item)) {
        out.push({
          id: 'UNIDENTIFIED',
          packageName,
          severity: 'unknown',
          title: '(malformed)',
          url: '',
        })
        continue
      }
      const url = typeof item.url === 'string' ? item.url : ''
      const fromUrl = url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0]
      const cve = url.match(/CVE-\d{4}-\d+/i)?.[0]
      const fallback =
        typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : ''
      const id = fromUrl ?? cve ?? (fallback || 'UNIDENTIFIED')
      out.push({
        id,
        packageName,
        severity: String(item.severity ?? 'unknown').toLowerCase(),
        title: typeof item.title === 'string' ? item.title : '(no title)',
        url,
        vulnerableVersions:
          typeof item.vulnerable_versions === 'string' ? item.vulnerable_versions : undefined,
      })
    }
  }
  return out
}

export type LoadedExceptions = {
  active: Map<string, AuditException>
  expired: AuditException[]
  invalid: string[]
}

export function loadExceptionFile(path: string, now = new Date()): LoadedExceptions {
  const active = new Map<string, AuditException>()
  const expired: AuditException[] = []
  const invalid: string[] = []

  if (!existsSync(path)) {
    return { active, expired, invalid }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    invalid.push(`failed to parse exception file: ${String(error)}`)
    return { active, expired, invalid }
  }

  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.exceptions)) {
    invalid.push('exception file must be { "version": 1, "exceptions": [...] }')
    return { active, expired, invalid }
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const latestAllowed = todayUtc + MAX_EXCEPTION_DAYS * DAY_MS

  for (const [i, entry] of parsed.exceptions.entries()) {
    if (!isRecord(entry)) {
      invalid.push(`exceptions[${i}]: not an object`)
      continue
    }
    const { id, reason, owner, expires } = entry
    if (
      typeof id !== 'string' ||
      typeof reason !== 'string' ||
      typeof owner !== 'string' ||
      typeof expires !== 'string' ||
      !id.trim() ||
      !reason.trim() ||
      !owner.trim()
    ) {
      invalid.push(`exceptions[${i}]: requires non-empty id, reason, owner and expires`)
      continue
    }
    if (!/^(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-\d{4}-\d+)$/i.test(id.trim())) {
      invalid.push(`exceptions[${i}]: id must be a single GHSA or CVE id (got ${id})`)
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
      invalid.push(`exceptions[${i}]: expires must be YYYY-MM-DD`)
      continue
    }
    const expiresUtc = Date.parse(`${expires}T00:00:00.000Z`)
    if (Number.isNaN(expiresUtc)) {
      invalid.push(`exceptions[${i}]: invalid expires date ${expires}`)
      continue
    }
    if (expiresUtc > latestAllowed) {
      invalid.push(
        `exceptions[${i}]: expires ${expires} is more than ${MAX_EXCEPTION_DAYS} days away`,
      )
      continue
    }
    const exception: AuditException = {
      id,
      reason,
      owner,
      expires,
      package: typeof entry.package === 'string' ? entry.package : undefined,
      review_url: typeof entry.review_url === 'string' ? entry.review_url : undefined,
    }
    if (expiresUtc < todayUtc) {
      expired.push(exception)
      continue
    }
    active.set(normalizeAdvisoryId(id), exception)
  }

  return { active, expired, invalid }
}

export type GateResult = {
  ok: boolean
  residual: AuditAdvisory[]
  appliedExceptions: AuditException[]
  unusedExceptions: AuditException[]
  expiredMatching: AuditException[]
  invalid: string[]
  summary: string
}

export function evaluateAuditGate(
  advisories: AuditAdvisory[],
  exceptionPath: string,
  now = new Date(),
): GateResult {
  const { active, expired, invalid } = loadExceptionFile(exceptionPath, now)

  if (invalid.length > 0) {
    return {
      ok: false,
      residual: advisories,
      appliedExceptions: [],
      unusedExceptions: [],
      expiredMatching: [],
      invalid,
      summary: `FAIL: invalid exception file: ${invalid.join('; ')}`,
    }
  }

  const expiredById = new Map(expired.map((e) => [normalizeAdvisoryId(e.id), e]))
  const applied = new Map<string, AuditException>()
  const expiredMatching = new Map<string, AuditException>()
  const residual = new Map<string, AuditAdvisory>()

  for (const advisory of advisories) {
    const key = normalizeAdvisoryId(advisory.id)
    const exception = active.get(key)
    if (exception) {
      applied.set(key, exception)
      continue
    }
    const stale = expiredById.get(key)
    if (stale) expiredMatching.set(key, stale)
    residual.set(`${advisory.packageName}::${key}`, advisory)
  }

  const unused = [...active.entries()].filter(([key]) => !applied.has(key)).map(([, ex]) => ex)
  const residualList = [...residual.values()]
  const counts = new Map<string, number>()
  for (const advisory of residualList) {
    counts.set(advisory.severity, (counts.get(advisory.severity) ?? 0) + 1)
  }
  const residualLabel = [...counts.entries()]
    .sort((a, b) => (SEVERITY_RANK[b[0]] ?? 0) - (SEVERITY_RANK[a[0]] ?? 0))
    .map(([severity, n]) => `${n} ${severity}`)
    .join(', ')

  const ok = residualList.length === 0
  let summary: string
  if (!ok && expiredMatching.size > 0) {
    summary = `FAIL: ${expiredMatching.size} expired exception(s) still match live advisories; ${residualList.length} residual (${residualLabel})`
  } else if (!ok) {
    summary = `FAIL: ${residualList.length} residual advisory(ies) (${residualLabel})`
  } else if (advisories.length === 0) {
    summary = 'PASS: no vulnerabilities found'
  } else {
    summary = `PASS: ${advisories.length} advisory(ies) covered by ${applied.size} active exception(s); 0 residual`
  }

  return {
    ok,
    residual: residualList,
    appliedExceptions: [...applied.values()],
    unusedExceptions: unused,
    expiredMatching: [...expiredMatching.values()],
    invalid,
    summary,
  }
}

export type AuditRun = { json: unknown; status: number | null; error?: string }

/**
 * Turn a raw `bun audit --json` run into a parsed report, failing closed:
 * a non-zero exit with no advisories in the report is an audit failure
 * (registry or network error), not a clean tree.
 */
export function interpretAuditRun(stdout: string, status: number | null): AuditRun {
  const trimmed = stdout.trim()
  let json: unknown = {}
  if (trimmed !== '') {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return { json: null, status, error: `no JSON object in output: ${trimmed.slice(0, 400)}` }
    }
    try {
      json = JSON.parse(trimmed.slice(start, end + 1))
    } catch (error) {
      return { json: null, status, error: `unparseable JSON: ${String(error)}` }
    }
  }
  if (status !== 0 && parseBunAuditJson(json).length === 0) {
    return { json: null, status, error: `bun audit exited ${status} without reporting advisories` }
  }
  return { json, status }
}

function runBunAuditJson(cwd: string): AuditRun {
  const result = spawnSync('bun', ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.error) {
    return { json: null, status: result.status, error: String(result.error) }
  }
  const run = interpretAuditRun(result.stdout ?? '', result.status)
  if (run.error && result.stderr) {
    return { ...run, error: `${run.error}\n${result.stderr}` }
  }
  return run
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

export function main(argv = process.argv.slice(2)): number {
  const repoRoot = resolve(argValue(argv, '--cwd') ?? process.cwd())
  const exceptionPath = resolve(
    repoRoot,
    argValue(argv, '--exceptions') ?? '.github/dependency-audit-exceptions.json',
  )

  const run = runBunAuditJson(repoRoot)
  if (run.error) {
    console.error(`dependency-audit: ${run.error}`)
    return 2
  }

  const advisories = parseBunAuditJson(run.json)
  const gate = evaluateAuditGate(advisories, exceptionPath)

  console.log(`dependency-audit: bun exit=${run.status} advisories=${advisories.length}`)
  console.log(`dependency-audit: ${gate.summary}`)

  for (const ex of gate.appliedExceptions) {
    console.log(`  exception ${ex.id} (expires ${ex.expires}, owner ${ex.owner})`)
  }
  for (const ex of gate.unusedExceptions) {
    console.warn(`  unused exception ${ex.id}: no live advisory matches it; remove the entry`)
  }
  for (const ex of gate.expiredMatching) {
    console.error(`  expired exception ${ex.id} (expired ${ex.expires}) still matches`)
  }
  for (const msg of gate.invalid) {
    console.error(`  exception file: ${msg}`)
  }
  if (gate.residual.length > 0) {
    console.error('Residual advisories:')
    for (const a of gate.residual) {
      console.error(`  [${a.severity}] ${a.packageName} ${a.id}: ${a.title} ${a.url}`)
    }
    console.error(
      'Fix with a compatible bump or a bounded override, or add a time-boxed exception (docs/security/dependency-audit-policy.md).',
    )
  }

  return gate.ok ? 0 : 1
}

if (import.meta.main) {
  process.exit(main())
}
