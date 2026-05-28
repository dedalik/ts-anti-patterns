// Clover XML parser. Atlassian/OpenClover format used by older test runners
// (PHPUnit, some Java tooling) and supported by istanbul as an output target.
//
// Structure we care about:
//   <coverage>
//     <project>
//       <file path="src/foo.ts">
//         <metrics ... />
//         <line num="N" count="K" type="stmt|cond|method" />
//       </file>
//     </project>
//   </coverage>

import { XMLParser } from "fast-xml-parser"
import {
  emptyFileCoverage,
  type CoverageMap,
  type FileCoverage,
} from "./types.js"

export interface ParseCloverOptions {
  sourcePath: string
}

interface CloverLine {
  "@_num"?: string | number
  "@_count"?: string | number
  "@_type"?: string
  "@_truecount"?: string | number
  "@_falsecount"?: string | number
}

interface CloverFile {
  "@_path"?: string
  "@_name"?: string
  line?: CloverLine | CloverLine[]
}

interface CloverProject {
  file?: CloverFile | CloverFile[]
  package?: CloverPackage | CloverPackage[]
}

interface CloverPackage {
  file?: CloverFile | CloverFile[]
}

interface CloverDoc {
  coverage?: { project?: CloverProject | CloverProject[] }
}

export function parseClover(text: string, opts: ParseCloverOptions): CoverageMap {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: true,
    isArray: (name) => name === "file" || name === "line" || name === "package",
  })

  let parsed: CloverDoc
  try {
    parsed = parser.parse(text) as CloverDoc
  } catch {
    return emptyMap(opts.sourcePath)
  }

  const projects = arrayOf(parsed.coverage?.project)
  const files = new Map<string, FileCoverage>()
  let hasBranch = false
  let hasLine = false

  for (const project of projects) {
    const fileBuckets = [
      ...arrayOf(project.file),
      ...arrayOf(project.package).flatMap((p) => arrayOf(p.file)),
    ]
    for (const f of fileBuckets) {
      const path = f["@_path"] ?? f["@_name"]
      if (!path) continue
      const cov = emptyFileCoverage()
      for (const ln of arrayOf(f.line)) {
        const num = toInt(ln["@_num"])
        const count = toInt(ln["@_count"])
        if (!num) continue
        cov.lineHits.set(num, (cov.lineHits.get(num) ?? 0) + count)
        hasLine = true
        if (ln["@_type"] === "cond") {
          const trueCount = toInt(ln["@_truecount"])
          const falseCount = toInt(ln["@_falsecount"])
          const bucket = cov.branchHitsByLine.get(num) ?? []
          bucket.push({ block: 0, branch: 0, taken: trueCount })
          bucket.push({ block: 0, branch: 1, taken: falseCount })
          cov.branchHitsByLine.set(num, bucket)
          hasBranch = true
        }
      }
      if (cov.lineHits.size + cov.branchHitsByLine.size > 0) {
        files.set(String(path), cov)
      }
    }
  }

  return {
    files,
    source: {
      format: "clover",
      path: opts.sourcePath,
      hasBranch,
      hasFn: false,
      hasLine,
    },
  }
}

function emptyMap(sourcePath: string): CoverageMap {
  return {
    files: new Map(),
    source: {
      format: "clover",
      path: sourcePath,
      hasBranch: false,
      hasFn: false,
      hasLine: false,
    },
  }
}

function arrayOf<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

function toInt(v: string | number | undefined): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  if (typeof v === "string") {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}
