// Translate coverage coordinates from generated files back to original
// sources via `*.map` sidecars. Used when coverage was taken on a transpiled
// build (dist/*.js) but the analysis runs against the TypeScript sources.
//
// Strategy:
//   1. For each file in the CoverageMap, look for `<file>.map` next to it,
//      or read the `//# sourceMappingURL=` pragma from its content.
//   2. For each (line, column? -> we don't have column for FN/DA, so we
//      pass column=0) translate to { source, line } via SourceMapConsumer.
//   3. Build a new CoverageMap keyed by the ORIGINAL source paths, with all
//      hits re-keyed to the original line numbers.
//
// Coordinates that don't map (no source map, or no mapping for that line)
// are passed through unchanged so we don't silently drop data.

import { readFile } from "node:fs/promises"
import { dirname, resolve, isAbsolute } from "node:path"
import { existsSync } from "node:fs"
import { SourceMapConsumer, type RawSourceMap } from "source-map"
import {
  emptyFileCoverage,
  type CoverageMap,
  type FileCoverage,
} from "./coverage/types.js"

export interface SourceMapOptions {
  // Directory used to resolve sourceMappingURL when it's relative.
  // Defaults to the directory of the generated file itself.
  baseDir?: string
}

export async function translateCoverage(
  cov: CoverageMap,
  opts: SourceMapOptions = {}
): Promise<CoverageMap> {
  const out = new Map<string, FileCoverage>()

  for (const [generatedPath, fileCov] of cov.files) {
    const sm = await loadSourceMap(generatedPath, opts.baseDir)
    if (!sm) {
      out.set(generatedPath, fileCov)
      continue
    }
    try {
      await projectOne(out, generatedPath, fileCov, sm)
    } finally {
      sm.destroy()
    }
  }

  return { files: out, source: cov.source }
}

async function projectOne(
  out: Map<string, FileCoverage>,
  generatedPath: string,
  fileCov: FileCoverage,
  sm: SourceMapConsumer
): Promise<void> {
  // FN
  for (const [line, fn] of fileCov.fnHitsByLine) {
    const orig = sm.originalPositionFor({ line, column: 0 })
    const key = orig.source ?? generatedPath
    const target = ensureFile(out, key)
    const targetLine = orig.line ?? line
    const prev = target.fnHitsByLine.get(targetLine)
    if (!prev || fn.hits > prev.hits) target.fnHitsByLine.set(targetLine, fn)
  }
  // Line
  for (const [line, hits] of fileCov.lineHits) {
    const orig = sm.originalPositionFor({ line, column: 0 })
    const key = orig.source ?? generatedPath
    const target = ensureFile(out, key)
    const targetLine = orig.line ?? line
    target.lineHits.set(targetLine, (target.lineHits.get(targetLine) ?? 0) + hits)
  }
  // Branch
  for (const [line, hits] of fileCov.branchHitsByLine) {
    const orig = sm.originalPositionFor({ line, column: 0 })
    const key = orig.source ?? generatedPath
    const target = ensureFile(out, key)
    const targetLine = orig.line ?? line
    const bucket = target.branchHitsByLine.get(targetLine) ?? []
    bucket.push(...hits)
    target.branchHitsByLine.set(targetLine, bucket)
  }
}

function ensureFile(map: Map<string, FileCoverage>, key: string): FileCoverage {
  let v = map.get(key)
  if (!v) {
    v = emptyFileCoverage()
    map.set(key, v)
  }
  return v
}

async function loadSourceMap(
  generatedPath: string,
  baseDir?: string
): Promise<SourceMapConsumer | null> {
  const sidecar = `${generatedPath}.map`
  if (existsSync(sidecar)) {
    return await fromFile(sidecar)
  }

  // Try reading sourceMappingURL from the generated file.
  if (existsSync(generatedPath)) {
    try {
      const text = await readFile(generatedPath, "utf8")
      const url = extractSourceMappingURL(text)
      if (url) {
        if (url.startsWith("data:")) {
          return await fromInlineDataURL(url)
        }
        const base = baseDir ?? dirname(generatedPath)
        const mapPath = isAbsolute(url) ? url : resolve(base, url)
        if (existsSync(mapPath)) return await fromFile(mapPath)
      }
    } catch {
      // ignore
    }
  }
  return null
}

async function fromFile(path: string): Promise<SourceMapConsumer | null> {
  try {
    const text = await readFile(path, "utf8")
    const raw = JSON.parse(text) as RawSourceMap
    return await new SourceMapConsumer(raw)
  } catch {
    return null
  }
}

async function fromInlineDataURL(url: string): Promise<SourceMapConsumer | null> {
  // data:application/json;base64,<payload>  or charset=utf-8;... ,<payload>
  const comma = url.indexOf(",")
  if (comma === -1) return null
  const meta = url.slice(0, comma)
  const payload = url.slice(comma + 1)
  let json: string
  try {
    json = meta.includes("base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload)
    const raw = JSON.parse(json) as RawSourceMap
    return await new SourceMapConsumer(raw)
  } catch {
    return null
  }
}

function extractSourceMappingURL(text: string): string | null {
  // Scan only the last 4KB to avoid full-file regex on huge bundles.
  const tail = text.length > 4096 ? text.slice(-4096) : text
  const m = tail.match(/[#@]\s*sourceMappingURL\s*=\s*([^\s'"]+)/)
  return m ? (m[1] ?? null) : null
}
