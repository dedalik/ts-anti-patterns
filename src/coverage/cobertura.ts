// Cobertura XML parser. Originally Java/Maven; emitted by jacoco-cobertura,
// istanbul (cobertura reporter), and some Python tools (coverage.py).
//
// Structure:
//   <coverage>
//     <packages>
//       <package>
//         <classes>
//           <class filename="src/foo.ts">
//             <methods>
//               <method name="..." signature="..." line-rate="..." />
//             </methods>
//             <lines>
//               <line number="N" hits="K" branch="true|false"
//                     condition-coverage="50% (1/2)" />
//             </lines>
//           </class>
//         </classes>
//       </package>
//     </packages>
//   </coverage>

import { XMLParser } from "fast-xml-parser"
import {
  emptyFileCoverage,
  type CoverageMap,
  type FileCoverage,
} from "./types.js"

export interface ParseCoberturaOptions {
  sourcePath: string
}

interface CobLine {
  "@_number"?: string | number
  "@_hits"?: string | number
  "@_branch"?: string | boolean
  "@_condition-coverage"?: string
}

interface CobClass {
  "@_filename"?: string
  lines?: { line?: CobLine | CobLine[] }
}

interface CobPackage {
  classes?: { class?: CobClass | CobClass[] }
}

interface CobDoc {
  coverage?: {
    packages?: { package?: CobPackage | CobPackage[] }
  }
}

export function parseCobertura(text: string, opts: ParseCoberturaOptions): CoverageMap {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: true,
    isArray: (name) => name === "package" || name === "class" || name === "line",
  })

  let parsed: CobDoc
  try {
    parsed = parser.parse(text) as CobDoc
  } catch {
    return emptyMap(opts.sourcePath)
  }

  const files = new Map<string, FileCoverage>()
  let hasBranch = false
  let hasLine = false

  const packages = arrayOf(parsed.coverage?.packages?.package)
  for (const pkg of packages) {
    const classes = arrayOf(pkg.classes?.class)
    for (const cls of classes) {
      const filename = cls["@_filename"]
      if (!filename) continue
      const cov = files.get(String(filename)) ?? emptyFileCoverage()
      for (const ln of arrayOf(cls.lines?.line)) {
        const num = toInt(ln["@_number"])
        const hits = toInt(ln["@_hits"])
        if (!num) continue
        cov.lineHits.set(num, (cov.lineHits.get(num) ?? 0) + hits)
        hasLine = true
        if (asBool(ln["@_branch"])) {
          const { taken, total } = parseConditionCoverage(ln["@_condition-coverage"])
          if (total > 0) {
            const bucket = cov.branchHitsByLine.get(num) ?? []
            for (let i = 0; i < total; i++) {
              bucket.push({ block: 0, branch: i, taken: i < taken ? 1 : 0 })
            }
            cov.branchHitsByLine.set(num, bucket)
            hasBranch = true
          }
        }
      }
      if (cov.lineHits.size + cov.branchHitsByLine.size > 0) {
        files.set(String(filename), cov)
      }
    }
  }

  return {
    files,
    source: {
      format: "cobertura",
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
      format: "cobertura",
      path: sourcePath,
      hasBranch: false,
      hasFn: false,
      hasLine: false,
    },
  }
}

// condition-coverage="50% (1/2)" → { taken: 1, total: 2 }
function parseConditionCoverage(raw: string | undefined): { taken: number; total: number } {
  if (!raw) return { taken: 0, total: 0 }
  const m = raw.match(/\((\d+)\/(\d+)\)/)
  if (!m) return { taken: 0, total: 0 }
  return { taken: parseInt(m[1] ?? "0", 10), total: parseInt(m[2] ?? "0", 10) }
}

function asBool(v: string | boolean | undefined): boolean {
  if (typeof v === "boolean") return v
  return v === "true"
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
