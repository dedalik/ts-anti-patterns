// Programmatic API surface. The CLI uses these same building blocks;
// this test pins down the contract for library users.

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  analyze,
  computeCrap,
  renderJson,
  renderHuman,
  renderHtml,
  renderMarkdown,
  renderSarif,
  GLOSSARY,
  explain,
} from "../src/index.js"

const dirs: string[] = []
function fixtureProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "ts-anti-patterns-api-"))
  dirs.push(dir)
  writeFileSync(
    join(dir, "a.ts"),
    `
export function ladder(n: number): number {
  if (n === 1) return 1
  if (n === 2) return 2
  if (n === 3) return 3
  return 0
}

export function trivial(): number { return 1 }
`
  )
  return dir
}

afterAll(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("programmatic API", () => {
  it("re-exports the scoring primitives", () => {
    expect(computeCrap(1, 100)).toBe(1)
    expect(computeCrap(12, 0)).toBeCloseTo(156, 6)
  })

  it("re-exports the glossary unmodified", () => {
    expect(GLOSSARY.crap).toBeDefined()
    expect(explain("crap")).toContain("CRAP score")
  })

  it("analyze() returns entries + meta for a tiny project", async () => {
    const dir = fixtureProject()
    const { entries, meta } = await analyze({ paths: [dir], threshold: 30, noCov: true })
    expect(entries.length).toBeGreaterThan(0)
    const ladder = entries.find((e) => e.function === "ladder")
    expect(ladder).toBeDefined()
    expect(ladder!.complexity).toBe(4)
    expect(meta.mode).toBe("cc")
    expect(meta.version).toBeTruthy()
  })

  it("analyze() result is renderable by every public renderer", async () => {
    const dir = fixtureProject()
    const { entries, meta } = await analyze({ paths: [dir], threshold: 5, noCov: true })

    const human = renderHuman(entries, meta, {
      threshold: 5,
      showHints: true,
      colors: false,
    })
    expect(human).toContain("ts-anti-patterns")

    const json = renderJson(entries, meta, { threshold: 5 })
    const parsed = JSON.parse(json) as { entries: unknown[] }
    expect(parsed.entries.length).toBe(entries.length)

    const html = await renderHtml(entries, meta, { threshold: 5 })
    expect(html.startsWith("<!doctype html>")).toBe(true)

    const md = renderMarkdown(entries, meta, { threshold: 5 })
    expect(md).toContain("| Sev | Score")

    const sarif = renderSarif(entries, meta, { threshold: 5 })
    const sarifObj = JSON.parse(sarif) as { version: string }
    expect(sarifObj.version).toBe("2.1.0")
  })
})
