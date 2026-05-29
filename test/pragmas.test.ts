import { describe, it, expect } from "vitest"
import { parsePragmas } from "../src/pragmas.js"

describe("pragmas", () => {
  it("returns empty map when there are no pragmas", () => {
    const result = parsePragmas("function f() { return 1 }\n")
    expect(result.size).toBe(0)
  })

  it("// ts-anti-patterns-ignore attaches to the next code line", () => {
    const source = [
      "// ts-anti-patterns-ignore",
      "function f() { return 1 }",
    ].join("\n")
    const result = parsePragmas(source)
    expect(result.get(2)?.suppressed?.reason).toBe("(no reason given)")
  })

  it("ignore captures a quoted reason", () => {
    const source = [
      '// ts-anti-patterns-ignore "legacy code, will rewrite in Q2"',
      "function f() { return 1 }",
    ].join("\n")
    expect(result(source, 2).suppressed?.reason).toBe(
      "legacy code, will rewrite in Q2"
    )
  })

  it("ignore captures an unquoted reason", () => {
    const source = [
      "// ts-anti-patterns-ignore migration target",
      "function f() { return 1 }",
    ].join("\n")
    expect(result(source, 2).suppressed?.reason).toBe("migration target")
  })

  it("// ts-anti-patterns-threshold sets a local threshold", () => {
    const source = [
      "// ts-anti-patterns-threshold 60",
      "function huge() { return 1 }",
    ].join("\n")
    expect(result(source, 2).localThreshold).toBe(60)
  })

  it("pragma + blank line + function still binds", () => {
    const source = [
      "// ts-anti-patterns-ignore",
      "",
      "",
      "function f() { return 1 }",
    ].join("\n")
    expect(result(source, 4).suppressed).toBeTruthy()
  })

  it("a non-pragma comment between breaks the binding", () => {
    const source = [
      "// ts-anti-patterns-ignore",
      "// some unrelated note",
      "function f() { return 1 }",
    ].join("\n")
    const map = parsePragmas(source)
    expect(map.size).toBe(0)
  })

  it("both directives stack on one function", () => {
    const source = [
      "// ts-anti-patterns-ignore tech debt",
      "// ts-anti-patterns-threshold 50",
      "function f() { return 1 }",
    ].join("\n")
    const got = result(source, 3)
    expect(got.suppressed?.reason).toBe("tech debt")
    expect(got.localThreshold).toBe(50)
  })

  it("invalid threshold value is ignored", () => {
    const source = [
      "// ts-anti-patterns-threshold nope",
      "function f() { return 1 }",
    ].join("\n")
    expect(parsePragmas(source).size).toBe(0)
  })
})

function result(source: string, line: number) {
  const map = parsePragmas(source)
  const got = map.get(line)
  if (!got) throw new Error(`no pragma found at line ${line}`)
  return got
}
