# Dependency audit policy

The CI Gate `Dependency audit` step runs `bun run audit:deps`
(`scripts/ci/dependency-audit.ts`). It runs `bun audit --json` over the whole
tree (production and development), removes advisories covered by an active
exception in `.github/dependency-audit-exceptions.json`, and fails if any
advisory of any severity is left.

The gate fails closed: an audit run that exits non-zero without a report, an
invalid exception file, or an expired exception that still matches a live
advisory all fail the step.

## Remediation order

1. Compatible bump within the existing range (refresh the lockfile).
2. Root `overrides` entry with a floor at the first patched version and a
   ceiling at the next major (or next minor for `0.x`), for example
   `"tar": ">=7.5.21 <8"`. Never an open floor.
3. Major upgrade of the direct dependency that pulls the package in, with its
   breaking changes reviewed and tests run.
4. Time-boxed exception, only when 1 to 3 are unavailable: no fixed release
   exists, or the fix is a major the consuming package cannot load.

## Exceptions

Each entry names exactly one GHSA or CVE id:

```json
{
  "id": "GHSA-xxxx-xxxx-xxxx",
  "package": "package-name",
  "reason": "why tiers 1 to 3 are unavailable, and where the package is reached",
  "owner": "github-handle",
  "expires": "YYYY-MM-DD"
}
```

- `expires` is a UTC date at most 90 days out; the gate rejects anything
  later.
- On expiry the advisory blocks again: fix it, or renew the entry in a
  reviewed PR with a fresh reason.
- The gate prints exceptions that no longer match any advisory; delete them.
- No package-wide ignores, no `--audit-level` thresholds, no
  `continue-on-error` on the step.

## Local check

```bash
bun run audit:deps
bun test scripts/ci
```
