// `ts-crap init` writes .ts-crap.json and adds an 'crap' npm script. It must
// be idempotent - running it twice doesn't clobber existing files.

import { describe, it, expect, beforeEach, afterAll } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runInit, quickStart } from "../src/init.js"

describe("runInit()", () => {
  let dir = ""
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ts-crap-init-"))
  })

  it("creates .ts-crap.json and adds the npm script when neither exists", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo" }, null, 2))
    const result = await runInit(dir)
    expect(result.configCreated).toBe(true)
    expect(result.scriptAdded).toBe(true)
    expect(existsSync(join(dir, ".ts-crap.json"))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      scripts?: Record<string, string>
    }
    expect(pkg.scripts?.crap).toBe("ts-crap")
  })

  it("is idempotent - second run does not clobber the config or script", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo" }, null, 2))
    await runInit(dir)
    // Tweak the config so we can verify it survives.
    writeFileSync(join(dir, ".ts-crap.json"), '{"threshold":42}\n')
    const result = await runInit(dir)
    expect(result.configCreated).toBe(false)
    expect(result.scriptAdded).toBe(false)
    expect(readFileSync(join(dir, ".ts-crap.json"), "utf8")).toBe('{"threshold":42}\n')
  })

  it("works without a package.json - just creates the config", async () => {
    const result = await runInit(dir)
    expect(result.configCreated).toBe(true)
    expect(result.scriptAdded).toBe(false)
    expect(result.notes.some((n) => n.includes("No package.json"))).toBe(true)
  })

  it("preserves the package.json indent style", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "demo" }, null, 4) + "\n"
    )
    await runInit(dir)
    const text = readFileSync(join(dir, "package.json"), "utf8")
    // 4-space indent means the second line starts with four spaces, not two.
    expect(text.split("\n")[1]).toMatch(/^    "/)
  })

  it("quickStart() prints all notes and the example invocations", () => {
    const out = quickStart({
      configCreated: true,
      scriptAdded: true,
      configPath: "/x/.ts-crap.json",
      notes: ["Created .ts-crap.json", "Added 'crap' script"],
    })
    expect(out).toContain("Created .ts-crap.json")
    expect(out).toContain("Added 'crap' script")
    expect(out).toContain("npm run crap")
    expect(out).toContain("--threshold 50")
    expect(out).toContain("--format html")
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })
})
