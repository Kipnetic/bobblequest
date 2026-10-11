import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres, { type Sql } from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/template_test'

let client: Sql | undefined

export async function isDbAvailable(): Promise<boolean> {
  try {
    const c = postgres(TEST_DATABASE_URL, { max: 1, connect_timeout: 3 })
    await c`SELECT 1`
    await c.end({ timeout: 1 })
    return true
  } catch (error) {
    // Locally the live suites skip without a database; in CI an unreachable
    // database is a failure, never a silent skip.
    if (process.env.CI === 'true') {
      throw new Error('TEST_DATABASE_URL is unreachable in CI', {
        cause: error,
      })
    }
    return false
  }
}

export async function getTestClient(): Promise<Sql> {
  if (!client) {
    client = postgres(TEST_DATABASE_URL, { max: 5, prepare: false })
  }
  return client
}

// Postgres error codes that indicate a DDL object already exists — safe to ignore
// during test-suite migrations that may run once per test file in parallel.
const IDEMPOTENT_CODES = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (extension, index type, etc.)
  '42701', // duplicate_column
  '42P16', // invalid_table_definition (duplicate index)
])

export async function runMigrations(sqlClient: Sql): Promise<void> {
  const migrationDir = join(__dirname, '../../migrations')
  if (!existsSync(migrationDir)) {
    throw new Error(`Migration directory not found: ${migrationDir}`)
  }

  const files = (await readdir(migrationDir)).filter((f) => f.endsWith('.sql')).sort()

  for (const file of files) {
    const content = await readFile(join(migrationDir, file), 'utf-8')
    const statements = content
      .split('--> statement-breakpoint')
      .map((s) =>
        s
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim(),
      )
      .filter((s) => s.length > 0)

    for (const stmt of statements) {
      try {
        await sqlClient.unsafe(stmt)
      } catch (err: unknown) {
        const code = (err as { code?: string }).code
        if (!code || !IDEMPOTENT_CODES.has(code)) {
          throw err
        }
        // Object already exists — schema is already applied; continue.
      }
    }
  }
}

export async function truncateTables(sqlClient: Sql): Promise<void> {
  await sqlClient.unsafe('TRUNCATE TABLE users, embeddings RESTART IDENTITY CASCADE')
}

export async function closeTestClient(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 })
    client = undefined
  }
}
