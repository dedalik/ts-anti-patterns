// `--diagnose <file>` prints every discovered function plus the reason
// each entry was kept or filtered. We assert on the structure, not on
// the exact wording, so refactors don't crater the test.

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { diagnose } from "../src/diagnose.js"
import { DEFAULT_OPTIONS, type ResolvedOptions } from "../src/options.js"

function makeOpts(over: Partial<ResolvedOptions> = {}): ResolvedOptions {
  return { ...DEFAULT_OPTIONS, paths: ["."], ...over }
}

describe("diagnose()", () => {
  const dir = mkdtempSync(join(tmpdir(), "ts-anti-patterns-diagnose-"))
  const file = join(dir, "sample.ts")
  writeFileSync(
    file,
    `// ts-anti-patterns-ignore intentional ladder
export function ladder(x: number): number {
  if (x > 10) return 1
  if (x > 20) return 2
  if (x > 30) return 3
  return 0
}

[1, 2, 3].forEach(() => {
  // truly anonymous, no variable name to capture
})

export function plain(): number {
  return 2
}
`
  )

  it("lists every AST-discovered function with CC/Cog/SLOC", async () => {
    const out = await diagnose(file, {
      options: makeOpts(),
      coverage: null,
      displayPath: (abs) => abs.replace(dir + "/", ""),
    })
    expect(out).toContain("ts-anti-patterns diagnose")
    expect(out).toMatch(/functions discovered: \d+/)
    expect(out).toMatch(/ladder.*CC=4/)
    expect(out).toMatch(/plain.*CC=1/)
  })

  it("reports pragma suppression with reason", async () => {
    const out = await diagnose(file, {
      options: makeOpts(),
      coverage: null,
      displayPath: (abs) => abs.replace(dir + "/", ""),
    })
    expect(out).toMatch(/pragma: suppressed.*intentional ladder/)
  })

  it("reports anonymous arrows as filtered when --skip-anonymous is on", async () => {
    const out = await diagnose(file, {
      options: makeOpts({ skipAnonymous: true }),
      coverage: null,
      displayPath: (abs) => abs.replace(dir + "/", ""),
    })
    expect(out).toMatch(/<arrow@\d+>[\s\S]*?filtered \(skipAnonymous\)/)
  })

  it("shows the config path when present", async () => {
    const out = await diagnose(file, {
      options: makeOpts(),
      coverage: null,
      displayPath: (abs) => abs.replace(dir + "/", ""),
      configPath: "/proj/.ts-anti-patterns.json",
      configSha: "abc123",
    })
    expect(out).toContain("/proj/.ts-anti-patterns.json")
    expect(out).toContain("[abc123]")
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
})
