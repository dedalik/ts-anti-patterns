// Per-file metrics cache, keyed by mtime+size. Invalidated when the
// analysis-affecting options change, so the same source can never be
// served from a stale entry computed under different settings.

import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { openCache } from "../src/cache.js"
import type { FunctionMetric } from "../src/options.js"

const COG_ON = { cognitive: true, countNullishCoalescing: false }
const COG_OFF = { cognitive: false, countNullishCoalescing: false }

function mkMetric(over: Partial<FunctionMetric> = {}): FunctionMetric {
  return {
    file: "/x/a.ts",
    function: "f",
    line: 10,
    endLine: 20,
    complexity: 3,
    cognitive: 1,
    sloc: 5,
    ...over,
  }
}

const root = mkdtempSync(join(tmpdir(), "ts-anti-patterns-cache-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe("openCache()", () => {
  it("returns undefined for unknown files, then serves a freshly stored entry", async () => {
    const file = join(root, "fresh.ts")
    writeFileSync(file, "export const x = 1\n")
    const cache = await openCache(root, COG_ON)
    expect(cache.get(file)).toBeUndefined()
    cache.set(file, [mkMetric({ file })])
    expect(cache.get(file)).toHaveLength(1)
  })

  it("invalidates the entry when the file mtime changes", async () => {
    const file = join(root, "changing.ts")
    writeFileSync(file, "export const x = 1\n")
    const cache = await openCache(root, COG_ON)
    cache.set(file, [mkMetric({ file })])
    expect(cache.get(file)).toBeDefined()
    // Bump mtime ~1s in the future.
    const now = new Date(Date.now() + 1000)
    utimesSync(file, now, now)
    expect(cache.get(file)).toBeUndefined()
  })

  it("invalidates when size changes (same mtime, different content)", async () => {
    const file = join(root, "resized.ts")
    writeFileSync(file, "a")
    const cache = await openCache(root, COG_ON)
    cache.set(file, [mkMetric({ file })])
    expect(cache.get(file)).toBeDefined()
    writeFileSync(file, "ab") // size +1, mtime updated to now by fs.writeFile
    expect(cache.get(file)).toBeUndefined()
  })

  it("save+reopen returns the same metrics when opts match", async () => {
    const file = join(root, "persist.ts")
    writeFileSync(file, "export const y = 2\n")
    const c1 = await openCache(root, COG_ON)
    c1.set(file, [mkMetric({ file, function: "y" })])
    await c1.save()

    const c2 = await openCache(root, COG_ON)
    expect(c2.get(file)?.[0]?.function).toBe("y")
  })

  it("opts mismatch forces a cold cache (different optsKey)", async () => {
    const file = join(root, "optskey.ts")
    writeFileSync(file, "export const z = 3\n")
    const c1 = await openCache(root, COG_ON)
    c1.set(file, [mkMetric({ file, function: "z" })])
    await c1.save()

    const c2 = await openCache(root, COG_OFF)
    expect(c2.get(file)).toBeUndefined()
  })
})
