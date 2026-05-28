// `--jobs N` wires p-limit around per-file analysis. We assert:
//   - varying N changes nothing user-visible in the JSON envelope except
//     the `command` field (which echoes argv).
//   - N=1 is allowed and works (no concurrency).
//   - N=16 is allowed and works.

import { describe, it, expect } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { resolve } from "node:path"

const execFileP = promisify(execFile)
const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js")
const FIXTURE = resolve(import.meta.dirname, "fixtures", "tiny")

async function runJson(args: string[]): Promise<unknown> {
  const r = await execFileP("node", [CLI, ...args])
  return JSON.parse(r.stdout)
}

function stripVolatile<T>(envelope: T): T {
  const e = envelope as {
    meta?: {
      generatedAt?: string
      command?: string
      node?: string
      cwd?: string
      stickyDelta?: unknown
    }
  }
  if (e.meta) {
    delete e.meta.generatedAt
    delete e.meta.command
    delete e.meta.node
    delete e.meta.cwd
    delete e.meta.stickyDelta
  }
  return envelope
}

describe("--jobs concurrency", () => {
  it("produces the same entries at N=1 and N=8", async () => {
    const a = await runJson([FIXTURE, "--threshold", "999", "--no-cov", "--no-cache", "--jobs", "1", "--format", "json"])
    const b = await runJson([FIXTURE, "--threshold", "999", "--no-cov", "--no-cache", "--jobs", "8", "--format", "json"])
    expect(stripVolatile(a)).toEqual(stripVolatile(b))
  })

  it("entries land in a deterministic order across N values", async () => {
    type Env = { entries: { function: string; file: string; line: number }[] }
    const order = (env: Env) => env.entries.map((e) => `${e.file}::${e.line}::${e.function}`)
    const a = (await runJson([FIXTURE, "--threshold", "999", "--no-cov", "--no-cache", "--jobs", "1", "--format", "json"])) as Env
    const b = (await runJson([FIXTURE, "--threshold", "999", "--no-cov", "--no-cache", "--jobs", "16", "--format", "json"])) as Env
    expect(order(a)).toEqual(order(b))
  })

  it("rejects nothing for N=1 (no concurrency)", async () => {
    const r = await execFileP("node", [
      CLI,
      FIXTURE,
      "--threshold",
      "999",
      "--jobs",
      "1",
      "--no-cov",
      "--no-cache",
    ])
    expect(r.stderr).toBe("")
  })
})
