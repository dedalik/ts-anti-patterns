// Per-file metrics cache, keyed by mtime+size.
//
// The cache lives at .ts-anti-patterns-cache/metrics.json. We never trust the AST
// from disk if the file mtime or size has changed - we recompute. We also
// invalidate the whole cache whenever the analysis-affecting options change
// (cognitive on/off, count-nullish-coalescing on/off) because they alter
// metric values for the same source.

import { existsSync, statSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { FunctionMetric } from "./options.js"
import type { ComplexityOptions } from "./complexity.js"

export const CACHE_PATH = ".ts-anti-patterns-cache/metrics.json"

interface CacheEntry {
  mtime: number
  size: number
  metrics: FunctionMetric[]
}

interface CacheEnvelope {
  version: 1
  optsKey: string
  files: Record<string, CacheEntry>
}

export interface Cache {
  get(file: string): FunctionMetric[] | undefined
  set(file: string, metrics: FunctionMetric[]): void
  save(): Promise<void>
}

const NOOP_CACHE: Cache = {
  get: () => undefined,
  set: () => undefined,
  save: async () => undefined,
}

export function noopCache(): Cache {
  return NOOP_CACHE
}

export async function openCache(root: string, opts: ComplexityOptions): Promise<Cache> {
  const path = resolve(root, CACHE_PATH)
  const optsKey = JSON.stringify({ cognitive: !!opts.cognitive, nullish: !!opts.countNullishCoalescing })

  let envelope: CacheEnvelope = { version: 1, optsKey, files: {} }
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as CacheEnvelope
      if (parsed.version === 1 && parsed.optsKey === optsKey && parsed.files) {
        envelope = parsed
      }
    } catch {
      // unreadable cache - start fresh
    }
  }

  return {
    get(file: string): FunctionMetric[] | undefined {
      const entry = envelope.files[file]
      if (!entry) return undefined
      try {
        const stat = statSync(file)
        if (stat.mtimeMs === entry.mtime && stat.size === entry.size) return entry.metrics
      } catch {
        // file vanished - drop the entry
      }
      delete envelope.files[file]
      return undefined
    },
    set(file: string, metrics: FunctionMetric[]): void {
      try {
        const stat = statSync(file)
        envelope.files[file] = { mtime: stat.mtimeMs, size: stat.size, metrics }
      } catch {
        // file is gone - nothing to cache
      }
    },
    async save(): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify(envelope), "utf8")
    },
  }
}
