// Phase 4 CLI e2e: every format renders, --baseline detects regressions,
// --fail-regression exits non-zero, --diagnose is a one-file mode,
// // ts-anti-patterns-ignore doesn't trip --fail-above.

import { describe, it, expect, beforeAll } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { writeFile, mkdtemp, rm, mkdir, copyFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const execFileP = promisify(execFile)
const CLI = resolve(import.meta.dirname, "..", "dist", "cli.js")
const FIXTURE_TINY = resolve(import.meta.dirname, "fixtures", "tiny")
const FIXTURE_LCOV = resolve(import.meta.dirname, "fixtures", "coverage", "vitest.lcov")

interface RunResult {
  stdout: string
  stderr: string
  code: number
}

async function runCli(args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  try {
    const r = await execFileP("node", [CLI, ...args], { cwd: opts.cwd })
    return { stdout: r.stdout, stderr: r.stderr, code: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 }
  }
}

describe("ts-anti-patterns CLI - Phase 4", () => {
  beforeAll(async () => {
    // Make sure dist/ is current; the build was already invoked by `npm run build`
    // in CI, but local runs of just this file via `vitest test/cli.phase4.e2e.test.ts`
    // benefit from the safety net.
    const { existsSync } = await import("node:fs")
    if (!existsSync(CLI)) {
      throw new Error("dist/cli.js missing - run `npm run build` first")
    }
  })

  it("--format markdown emits a GFM table with a heading", async () => {
    const r = await runCli([FIXTURE_TINY, "--lcov", FIXTURE_LCOV, "--format", "markdown", "--threshold", "30"])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/^## ts-anti-patterns report/m)
    expect(r.stdout).toContain("| Sev | Score")
  })

  it("--format github emits annotations only for non-ok severity", async () => {
    // Use a low threshold so something actually triggers.
    const r = await runCli([FIXTURE_TINY, "--lcov", FIXTURE_LCOV, "--format", "github", "--threshold", "5"])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/^::(notice|warning|error)\s/m)
    expect(r.stdout).not.toMatch(/^::error file=,line=,/m)
  })

  it("--format sarif emits valid SARIF 2.1.0 JSON", async () => {
    const r = await runCli([FIXTURE_TINY, "--lcov", FIXTURE_LCOV, "--format", "sarif", "--threshold", "5"])
    expect(r.code).toBe(0)
    const sarif = JSON.parse(r.stdout) as {
      version: string
      runs: { tool: { driver: { rules: { id: string }[] } } }[]
    }
    expect(sarif.version).toBe("2.1.0")
    expect(sarif.runs[0]!.tool.driver.rules[0]!.id).toBe("ts-anti-patterns/score")
  })

  it("--format pr-comment opens with the bot marker", async () => {
    const r = await runCli([FIXTURE_TINY, "--lcov", FIXTURE_LCOV, "--format", "pr-comment", "--threshold", "30"])
    expect(r.code).toBe(0)
    expect(r.stdout.startsWith("<!-- ts-anti-patterns-report -->")).toBe(true)
  })

  it("--summary prints headline only (no table)", async () => {
    const r = await runCli([FIXTURE_TINY, "--lcov", FIXTURE_LCOV, "--threshold", "30", "--summary"])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("avg CC")
    expect(r.stdout).not.toContain("Sev │")
  })

  it("--diagnose dumps every AST function from one file", async () => {
    const r = await runCli(["--diagnose", join(FIXTURE_TINY, "sample.ts")])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("ts-anti-patterns diagnose")
    expect(r.stdout).toMatch(/functions discovered:\s+\d+/)
  })

  it("--baseline + --fail-regression flags a real regression and exits non-zero", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ts-anti-patterns-baseline-"))
    try {
      // 1) Build a tiny project with a single low-CC function.
      await writeFile(
        join(tmp, "a.ts"),
        "export function f(n: number): number { return n + 1 }\n"
      )
      // 2) Snapshot the baseline.
      const baseline = await runCli(["a.ts", "--format", "json", "--no-cov"], { cwd: tmp })
      expect(baseline.code).toBe(0)
      await writeFile(join(tmp, "baseline.json"), baseline.stdout)

      // 3) Break it: explode CC.
      await writeFile(
        join(tmp, "a.ts"),
        [
          "export function f(n: number): number {",
          ...Array.from({ length: 15 }, (_, i) => `  if (n === ${i}) return ${i}`),
          "  return -1",
          "}",
          "",
        ].join("\n")
      )

      const after = await runCli(
        ["a.ts", "--baseline", "baseline.json", "--fail-regression", "--no-cov", "--format", "json"],
        { cwd: tmp }
      )
      expect(after.code).toBe(1)
      // The JSON envelope shows the new entry; the exit code carries the verdict.
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it("// ts-anti-patterns-ignore does NOT trip --fail-above", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ts-anti-patterns-ignore-"))
    try {
      await writeFile(
        join(tmp, "a.ts"),
        [
          "// ts-anti-patterns-ignore generated DSL",
          "export function ladder(n: number): number {",
          ...Array.from({ length: 20 }, (_, i) => `  if (n === ${i}) return ${i}`),
          "  return -1",
          "}",
          "",
        ].join("\n")
      )
      const r = await runCli(["a.ts", "--threshold", "5", "--fail-above", "--no-cov"], { cwd: tmp })
      // ladder() has CC well above 5, but the pragma suppresses it: exit 0.
      expect(r.code).toBe(0)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it("--workspace scans every package.json workspaces entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "ts-anti-patterns-workspace-"))
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "root", workspaces: ["packages/*"] })
      )
      for (const name of ["alpha", "beta"]) {
        const dir = join(root, "packages", name)
        await mkdir(join(dir, "src"), { recursive: true })
        await writeFile(join(dir, "package.json"), JSON.stringify({ name }))
        await writeFile(
          join(dir, "src", "index.ts"),
          `export function ${name}(): number { return 1 }\n`
        )
      }
      const r = await runCli(["--workspace", "--format", "json", "--no-cov"], { cwd: root })
      expect(r.code).toBe(0)
      const parsed = JSON.parse(r.stdout) as { entries: { function: string }[] }
      const fns = parsed.entries.map((e) => e.function)
      expect(fns).toContain("alpha")
      expect(fns).toContain("beta")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// Keep unused import warning quiet for copyFile (utility that may be useful
// to import later but isn't needed now).
void copyFile
