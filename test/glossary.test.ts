// One source of truth for glossary content. Verifies the HTML report and
// the `ts-crap explain` CLI both source from the same place.

import { describe, it, expect } from "vitest"
import { GLOSSARY, explain, listTerms } from "../src/glossary.js"

describe("glossary", () => {
  it("has the expected canonical entries", () => {
    expect(listTerms()).toEqual([
      "cc",
      "cognitive",
      "confidence",
      "coverage",
      "crap",
      "missing",
      "pragma",
      "severity",
    ])
  })

  it("every entry has title + text + html", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.title, key).toBeTruthy()
      expect(entry.text, key).toBeTruthy()
      expect(entry.html, key).toMatch(/<\w/) // at least one tag
    }
  })

  it("explain('crap') returns the CRAP formula", () => {
    const out = explain("crap")!
    expect(out).toContain("CRAP score")
    expect(out).toContain("comp² × (1 − cov/100)³ + comp")
  })

  it("explain accepts case-insensitive terms", () => {
    expect(explain("CRAP")).toBe(explain("crap"))
    expect(explain("  crap  ")).toBe(explain("crap"))
  })

  it("explain returns null for unknown terms", () => {
    expect(explain("not-a-term")).toBeNull()
  })
})
