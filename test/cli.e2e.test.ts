// E2E: run the built CLI against the tiny fixture and assert behaviour
// from the outside. Requires `npm run build` to have produced dist/cli.js.
// vitest's `globalSetup` hook would be more elegant; for Phase 1 we keep
// it simple and use a pretest check.

import { describe, it, expect, beforeAll } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { existsSync } from "node:fs"
import { resolve, join } from "node:path"

const execFileP = promisify(execFile)
const CLI = resolve("dist/cli.js")
const FIXTURE_DIR = resolve("test/fixtures/tiny")

describe.skipIf(!existsSync(CLI))("CLI e2e (requires `npm run build`)", () => {
  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(
        "dist/cli.js not built. Run `npm run build` before this test suite."
      )
    }
  })

  it("accepts an array of positional paths and analyzes them", async () => {
    const { stdout } = await execFileP("node", [
      CLI,
      FIXTURE_DIR,
      "--threshold",
      "30",
      "--format",
      "json",
    ])
    const report = JSON.parse(stdout) as {
      schemaVersion: string
      summary: { mode: string; functions: number }
      entries: { function: string; complexity: number }[]
    }
    expect(report.schemaVersion).toBeTruthy()
    expect(report.summary.mode).toBe("cc")
    expect(report.summary.functions).toBeGreaterThan(5)
    expect(report.entries.map((e) => e.function)).toContain("trivial")
  })

  it("--fail-above exits 1 when threshold is exceeded", async () => {
    let exit = 0
    let stderr = ""
    try {
      await execFileP("node", [
        CLI,
        FIXTURE_DIR,
        "--threshold",
        "1",
        "--fail-above",
        "--format",
        "json",
      ])
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { code: number; stderr: string }
      exit = err.code
      stderr = err.stderr ?? ""
    }
    expect(exit).toBe(1)
    expect(stderr).toBe("")
  })

  it("--fail-above passes (exit 0) with a generous threshold", async () => {
    const { stdout } = await execFileP("node", [
      CLI,
      FIXTURE_DIR,
      "--threshold",
      "999",
      "--fail-above",
      "--format",
      "json",
    ])
    expect(stdout.length).toBeGreaterThan(0)
  })

  it("dogfood: ts-anti-patterns ./src renders a JSON report", async () => {
    const { stdout } = await execFileP("node", [
      CLI,
      "./src",
      "--threshold",
      "30",
      "--format",
      "json",
    ])
    const report = JSON.parse(stdout) as { summary: { functions: number; errors: number; warnings: number } }
    expect(report.summary.functions).toBeGreaterThan(0)
  })

  it("--skip-anonymous hides arrow@N entries", async () => {
    const { stdout } = await execFileP("node", [
      CLI,
      FIXTURE_DIR,
      "--skip-anonymous",
      "--format",
      "json",
    ])
    const report = JSON.parse(stdout) as { entries: { function: string }[] }
    for (const entry of report.entries) {
      expect(entry.function).not.toMatch(/^<(arrow|fn)@\d+>$/)
    }
  })

  it("--count-nullish-coalescing changes withNullish CC", async () => {
    const off = await execFileP("node", [
      CLI,
      FIXTURE_DIR,
      "--format",
      "json",
    ])
    const on = await execFileP("node", [
      CLI,
      FIXTURE_DIR,
      "--count-nullish-coalescing",
      "--format",
      "json",
    ])
    const ccOff = pickCC(off.stdout, "withNullish")
    const ccOn = pickCC(on.stdout, "withNullish")
    expect(ccOff).toBe(1)
    expect(ccOn).toBeGreaterThan(ccOff)
  })

  it("skill subcommands install/show/path/uninstall work in --project scope", async () => {
    const { mkdtemp } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const tmp = await mkdtemp(join(tmpdir(), "ts-anti-patterns-skill-"))

    const pathRes = await execFileP("node", [CLI, "skill", "path", "--project"], { cwd: tmp })
    const expectedSuffix = join(".agents", "skills", "ts-anti-patterns", "SKILL.md")
    expect(pathRes.stdout.trim().endsWith(expectedSuffix)).toBe(true)
    const expected = join(tmp, expectedSuffix)

    const showRes = await execFileP("node", [CLI, "skill", "show"])
    expect(showRes.stdout).toMatch(/name:\s*ts-anti-patterns/)

    await execFileP("node", [CLI, "skill", "install", "--project"], { cwd: tmp })
    expect(existsSync(expected)).toBe(true)

    await execFileP("node", [CLI, "skill", "uninstall", "--project"], { cwd: tmp })
    expect(existsSync(expected)).toBe(false)
  })

})

function pickCC(stdout: string, fn: string): number {
  const r = JSON.parse(stdout) as { entries: { function: string; complexity: number }[] }
  const e = r.entries.find((x) => x.function === fn)
  if (!e) throw new Error(`${fn} not found`)
  return e.complexity
}

describe.skipIf(!existsSync(CLI))("CLI e2e - coverage (Phase 2)", () => {
  const LCOV = resolve("test/fixtures/coverage/vitest.lcov")

  it("--lcov pointing at a non-existent file exits 2 with a helpful message", async () => {
    let exit = 0
    let stderr = ""
    try {
      await execFileP("node", [CLI, FIXTURE_DIR, "--lcov", "/nope/missing.info"])
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { code: number; stderr: string }
      exit = err.code
      stderr = err.stderr ?? ""
    }
    expect(exit).toBe(2)
    expect(stderr).toMatch(/coverage file not found/)
  })

  it("--full + --coverage-command runs one-command CRAP analysis", async () => {
    const { mkdtemp, copyFile, mkdir } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const tmp = await mkdtemp(join(tmpdir(), "ts-anti-patterns-full-"))
    await mkdir(join(tmp, "test/fixtures/tiny"), { recursive: true })
    await copyFile(resolve("test/fixtures/tiny/sample.ts"), join(tmp, "test/fixtures/tiny/sample.ts"))
    await copyFile(resolve("package.json"), join(tmp, "package.json"))

    const coverageCommand = `node -e "const fs=require('node:fs');fs.mkdirSync('coverage',{recursive:true});fs.copyFileSync('${LCOV}','coverage/lcov.info')"`

    const { stdout } = await execFileP(
      "node",
      [
        CLI,
        "test/fixtures/tiny",
        "--threshold",
        "999",
        "--full",
        "--coverage-command",
        coverageCommand,
        "--format",
        "json",
      ],
      { cwd: tmp }
    )
    const report = JSON.parse(stdout) as { summary: { mode: string } }
    expect(report.summary.mode).toBe("crap")
  })

  it("--lcov vitest.lcov switches to CRAP mode with confidence column", async () => {
    const { stdout } = await execFileP("node", [
      CLI,
      FIXTURE_DIR,
      "--lcov",
      LCOV,
      "--threshold",
      "999", // don't fail-above; we only want output
      "--format",
      "json",
    ])
    const report = JSON.parse(stdout) as {
      summary: { mode: string; functions: number }
      meta: { coverageSource?: { kind: string; path: string } }
      entries: Array<{
        function: string
        coverage: number | null
        coverageKind: string | null
        confidence: string
        mode: string
      }>
    }
    expect(report.summary.mode).toBe("crap")
    expect(report.meta.coverageSource?.kind).toBe("branch")

    const trivial = report.entries.find((e) => e.function === "trivial")
    expect(trivial?.mode).toBe("crap")
    expect(trivial?.coverageKind).toBeTruthy()
    expect(trivial?.confidence).not.toBe("none")
  })

  it("stays in CC mode by default even when coverage/lcov.info exists", async () => {
    // Stage a coverage folder under the fixture directory.
    const { mkdtemp, writeFile, copyFile, mkdir } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const tmp = await mkdtemp(join(tmpdir(), "ts-anti-patterns-auto-"))
    await mkdir(join(tmp, "test/fixtures/tiny"), { recursive: true })
    await mkdir(join(tmp, "coverage"), { recursive: true })
    await copyFile(resolve("test/fixtures/tiny/sample.ts"), join(tmp, "test/fixtures/tiny/sample.ts"))
    const lcovText = (await import("node:fs/promises")).readFile(LCOV, "utf8")
    await writeFile(join(tmp, "coverage/lcov.info"), await lcovText)

    const { stdout } = await execFileP("node", [
      CLI,
      "test/fixtures/tiny",
      "--threshold",
      "999",
      "--format",
      "json",
    ], { cwd: tmp })
    const report = JSON.parse(stdout) as { summary: { mode: string } }
    expect(report.summary.mode).toBe("cc")
  })

  it("auto-detects coverage/lcov.info only with --cov", async () => {
    // Stage a coverage folder under the fixture directory.
    const { mkdtemp, writeFile, copyFile, mkdir } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const tmp = await mkdtemp(join(tmpdir(), "ts-anti-patterns-auto-"))
    await mkdir(join(tmp, "test/fixtures/tiny"), { recursive: true })
    await mkdir(join(tmp, "coverage"), { recursive: true })
    await copyFile(resolve("test/fixtures/tiny/sample.ts"), join(tmp, "test/fixtures/tiny/sample.ts"))
    const lcovText = (await import("node:fs/promises")).readFile(LCOV, "utf8")
    await writeFile(join(tmp, "coverage/lcov.info"), await lcovText)

    const { stdout } = await execFileP(
      "node",
      [
        CLI,
        "test/fixtures/tiny",
        "--threshold",
        "999",
        "--cov",
        "--format",
        "json",
      ],
      { cwd: tmp }
    )
    const report = JSON.parse(stdout) as { summary: { mode: string } }
    expect(report.summary.mode).toBe("crap")
  })
})
