// Parses LCOV coverage files into a map of file -> function -> coverage %

export interface FunctionCoverage {
  name: string
  hit: number
  found: number
}

export type CoverageMap = Map<string, Map<string, number>> // file -> fnName -> coverage%

export function parseLcov(lcovContent: string): CoverageMap {
  const result: CoverageMap = new Map()
  const lines = lcovContent.split("\n")

  let currentFile = ""
  const fnHits = new Map<string, number>()
  const fnNames = new Map<string, string>() // line -> name

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith("SF:")) {
      currentFile = trimmed.slice(3)
      fnHits.clear()
      fnNames.clear()
    } else if (trimmed.startsWith("FN:")) {
      // FN:<line>,<name>
      const parts = trimmed.slice(3).split(",")
      const lineNo = parts[0] ?? ""
      fnNames.set(lineNo, parts.slice(1).join(","))
    } else if (trimmed.startsWith("FNDA:")) {
      // FNDA:<count>,<name>
      const commaIdx = trimmed.indexOf(",")
      const count = parseInt(trimmed.slice(5, commaIdx), 10)
      const name = trimmed.slice(commaIdx + 1)
      fnHits.set(name, (fnHits.get(name) ?? 0) + count)
    } else if (trimmed === "end_of_record") {
      if (!currentFile) continue
      const fnMap = new Map<string, number>()
      for (const [, name] of fnNames) {
        const hits = fnHits.get(name) ?? 0
        fnMap.set(name, hits > 0 ? 100 : 0)
      }
      result.set(currentFile, fnMap)
      currentFile = ""
    }
  }

  return result
}

// Normalize path for matching (strip leading ./ and resolve relative)
export function normalizePath(p: string): string {
  return p.replace(/^\.\//, "").replace(/\\/g, "/")
}
