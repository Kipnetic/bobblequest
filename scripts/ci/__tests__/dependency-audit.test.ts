import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  evaluateAuditGate,
  interpretAuditRun,
  loadExceptionFile,
  parseBunAuditJson,
} from '../dependency-audit'

// Shape emitted by `bun audit --json` (Bun 1.4.2): numeric id, GHSA in the url.
const sampleJson = {
  'stream-json': [
    {
      id: 1241262,
      url: 'https://github.com/advisories/GHSA-hqr4-qq8f-hg3x',
      title: 'stream-json: JSONC parser and verifier re-scan the whole accumulated comment',
      severity: 'moderate',
      vulnerable_versions: '<=3.5.0',
      cwe: ['CWE-407'],
      cvss: { score: 6.2, vectorString: 'CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H' },
    },
  ],
  braces: [
    {
      id: 1240001,
      url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
      title: 'braces vulnerable to stack-exhaustion denial of service',
      severity: 'high',
      vulnerable_versions: '<=3.0.3',
    },
  ],
}

const now = new Date('2026-10-11T12:00:00.000Z')

function writeExceptions(exceptions: unknown[], version = 1): string {
  const dir = mkdtempSync(join(tmpdir(), 'audit-ex-'))
  const path = join(dir, 'exceptions.json')
  writeFileSync(path, JSON.stringify({ version, exceptions }, null, 2), 'utf8')
  return path
}

const exception = (id: string, expires = '2026-11-12') => ({
  id,
  reason: 'no fixed release',
  owner: 'owner',
  expires,
})

describe('parseBunAuditJson', () => {
  test('takes the GHSA id from the url, not the numeric id', () => {
    const advisories = parseBunAuditJson(sampleJson)
    expect(advisories.map((a) => a.id).sort()).toEqual([
      'GHSA-hqr4-qq8f-hg3x',
      'GHSA-vfj7-8cjw-p6xm',
    ])
    expect(advisories.find((a) => a.packageName === 'braces')?.severity).toBe('high')
  })

  test('an empty report is clean', () => {
    expect(parseBunAuditJson({})).toEqual([])
  })
})

describe('interpretAuditRun', () => {
  test('a non-zero exit with no advisories fails closed', () => {
    const run = interpretAuditRun('', 1)
    expect(run.json).toBeNull()
    expect(run.error).toMatch(/exited 1/)
  })

  test('garbage output fails closed', () => {
    expect(interpretAuditRun('error: registry unreachable', 1).json).toBeNull()
  })

  test('exit 1 with advisories is a report, not an error', () => {
    const run = interpretAuditRun(JSON.stringify(sampleJson), 1)
    expect(run.error).toBeUndefined()
    expect(parseBunAuditJson(run.json)).toHaveLength(2)
  })

  test('exit 0 with an empty map is clean', () => {
    const run = interpretAuditRun('{}', 0)
    expect(run.error).toBeUndefined()
    expect(parseBunAuditJson(run.json)).toEqual([])
  })
})

describe('loadExceptionFile', () => {
  test('rejects an expiry more than 90 days out', () => {
    const path = writeExceptions([exception('GHSA-vfj7-8cjw-p6xm', '2027-03-01')])
    expect(loadExceptionFile(path, now).invalid[0]).toMatch(/more than 90 days/)
  })

  test('rejects a package-name id', () => {
    const path = writeExceptions([exception('braces')])
    expect(loadExceptionFile(path, now).invalid[0]).toMatch(/single GHSA or CVE id/)
  })

  test('rejects an empty reason', () => {
    const path = writeExceptions([{ ...exception('GHSA-vfj7-8cjw-p6xm'), reason: ' ' }])
    expect(loadExceptionFile(path, now).invalid).toHaveLength(1)
  })
})

describe('evaluateAuditGate', () => {
  const advisories = parseBunAuditJson(sampleJson)

  test('fails on residual advisories with no exceptions', () => {
    const gate = evaluateAuditGate(advisories, writeExceptions([]), now)
    expect(gate.ok).toBe(false)
    expect(gate.residual).toHaveLength(2)
  })

  test('passes when every advisory has an active exception', () => {
    const path = writeExceptions([
      exception('GHSA-hqr4-qq8f-hg3x'),
      exception('ghsa-vfj7-8cjw-p6xm'),
    ])
    const gate = evaluateAuditGate(advisories, path, now)
    expect(gate.ok).toBe(true)
    expect(gate.appliedExceptions).toHaveLength(2)
  })

  test('an expired exception no longer silences its advisory', () => {
    const path = writeExceptions([
      exception('GHSA-hqr4-qq8f-hg3x', '2026-10-10'),
      exception('GHSA-vfj7-8cjw-p6xm'),
    ])
    const gate = evaluateAuditGate(advisories, path, now)
    expect(gate.ok).toBe(false)
    expect(gate.expiredMatching.map((e) => e.id)).toEqual(['GHSA-hqr4-qq8f-hg3x'])
    expect(gate.residual.map((a) => a.id)).toEqual(['GHSA-hqr4-qq8f-hg3x'])
  })

  test('an exception expiring today still applies', () => {
    const path = writeExceptions([
      exception('GHSA-hqr4-qq8f-hg3x', '2026-10-11'),
      exception('GHSA-vfj7-8cjw-p6xm'),
    ])
    expect(evaluateAuditGate(advisories, path, now).ok).toBe(true)
  })

  test('an invalid exception file fails closed', () => {
    const gate = evaluateAuditGate([], writeExceptions([], 2), now)
    expect(gate.ok).toBe(false)
    expect(gate.invalid.length).toBeGreaterThan(0)
  })

  test('reports exceptions that match nothing', () => {
    const path = writeExceptions([exception('GHSA-aaaa-bbbb-cccc')])
    const gate = evaluateAuditGate([], path, now)
    expect(gate.ok).toBe(true)
    expect(gate.unusedExceptions.map((e) => e.id)).toEqual(['GHSA-aaaa-bbbb-cccc'])
  })

  test('the committed exception file is valid today', () => {
    const path = resolve(import.meta.dir, '../../../.github/dependency-audit-exceptions.json')
    expect(loadExceptionFile(path).invalid).toEqual([])
  })
})
