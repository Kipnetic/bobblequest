---
paths:
  - "bunfig.toml"
  - "package.json"
  - "bun.lock"
---

# `bun install` failure-mode triage

**Applies to:** any agent debugging "bun install hangs/fails" in this repo.

## Diagnostic order (stop at first hit)

1. **`core.hooksPath` set?**
   `git config --local --get core.hooksPath` — must be empty. If set, `git config --local --unset-all core.hooksPath`. See `lefthook-and-hooks.md`.

2. **Bun version mismatch?**
   `bun --version` must satisfy the `packageManager` field in root `package.json` (currently `bun@1.4.2`). Upgrade/downgrade Bun to match.

3. **Both lockfiles present?**
   If both `bun.lockb` and `bun.lock` exist, DELETE `bun.lockb`. Repo commits text `bun.lock` only.

4. **Bunfig schema warnings?**
   Look for `warn: Unrecognized option in bunfig.toml` in install output. Fix any non-schema keys per `bunfig-invariants.md`.

5. **`Skip installing fsevents - os mismatch`?**
   This is NORMAL on Windows. Not an error. Move on.

6. **EPERM / EBUSY / copyfile errors?**
   Host-layer issue. See `windows-onedrive-host.md`.

## Hard prohibitions

- NEVER delete `bun.lock` to "fix" install issues. It is the source of truth and is committed.
- NEVER add `frozenLockfile`, `dryRun`, `ignoreScripts`, or `production` to `bunfig.toml` to work around install failures.
- NEVER pass `--no-verify` or set `LEFTHOOK_EXCLUDE` to get past a failing `prepare` hook.

## Escalation

If all 6 steps clear and install still fails, surface the exact error log to the parent — do not thrash retries.

Reason: Verified 2026-04-27 against Bun 1.3.11 + lefthook 2.x. This ordering catches the historical failure modes seen in this repo.
