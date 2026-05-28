// ts-crap HTML report - vanilla ESM, no dependencies, no network.
// Reads the embedded JSON, builds the table, wires the filters and slider,
// keeps the URL hash in sync so reports can be shared with a specific view.

const data = JSON.parse(document.getElementById("data").textContent || "{}")
const entries = Array.isArray(data.entries) ? data.entries : []
const meta = data.meta ?? {}
const glossary = data.glossary ?? {}
const initialThreshold = Number(meta.threshold ?? data.threshold ?? 30) || 30

const COLUMNS = [
  { key: "severity", label: "Sev", className: "col-sev", numeric: false, gloss: "severity" },
  { key: "score", label: "Score", className: "col-score", numeric: true, gloss: "crap" },
  { key: "complexity", label: "CC", className: "col-cc", numeric: true, gloss: "cc" },
  { key: "cognitive", label: "Cog", className: "col-cog", numeric: true, gloss: "cognitive" },
  { key: "sloc", label: "SLOC", className: "col-sloc", numeric: true, gloss: null },
  { key: "coverage", label: "Cov", className: "col-cov", numeric: true, gloss: "coverage", showInCrapOnly: true },
  { key: "confidence", label: "Conf", className: "col-conf", numeric: false, gloss: "confidence", showInCrapOnly: true },
  { key: "hint", label: "Hint", className: "col-hint", numeric: false, gloss: null },
  { key: "function", label: "Function", className: "col-function", numeric: false, gloss: null },
  { key: "location", label: "Location", className: "col-location", numeric: false, gloss: null },
]

const SEVERITY_ORDER = ["ok", "info", "warning", "error"]

const state = readHash({
  threshold: initialThreshold,
  search: "",
  above: false,
  trivial: false,
  suppressed: false,
  noCov: false,
  sort: "score:desc",
})

// Bind controls.
const ui = {
  threshold: document.getElementById("threshold"),
  thresholdReadout: document.getElementById("threshold-readout"),
  search: document.getElementById("search"),
  above: document.getElementById("t-above"),
  trivial: document.getElementById("t-trivial"),
  suppressed: document.getElementById("t-suppressed"),
  noCov: document.getElementById("t-no-cov"),
  export: document.getElementById("export-csv"),
  reset: document.getElementById("reset"),
  modeBadge: document.getElementById("mode-badge"),
  covSource: document.getElementById("cov-source"),
  summary: document.getElementById("summary"),
  theadRow: document.getElementById("thead-row"),
  rows: document.getElementById("crap-rows"),
  footer: document.getElementById("footer"),
  glossary: document.getElementById("glossary"),
  glossaryTitle: document.getElementById("glossary-title"),
  glossaryBody: document.getElementById("glossary-body"),
}

initStaticBits()
buildHead()
renderAll()

ui.threshold.value = String(state.threshold)
ui.search.value = state.search
ui.above.checked = state.above
ui.trivial.checked = state.trivial
ui.suppressed.checked = state.suppressed
ui.noCov.checked = state.noCov

ui.threshold.addEventListener("input", () => {
  state.threshold = Number(ui.threshold.value) || 30
  renderAll()
  writeHash()
})
ui.search.addEventListener("input", () => {
  state.search = ui.search.value
  renderAll()
  writeHash()
})
ui.above.addEventListener("change", () => {
  state.above = ui.above.checked
  renderAll()
  writeHash()
})
ui.trivial.addEventListener("change", () => {
  state.trivial = ui.trivial.checked
  renderAll()
  writeHash()
})
ui.suppressed.addEventListener("change", () => {
  state.suppressed = ui.suppressed.checked
  renderAll()
  writeHash()
})
ui.noCov.addEventListener("change", () => {
  state.noCov = ui.noCov.checked
  renderAll()
  writeHash()
})
ui.export.addEventListener("click", exportCsv)
ui.reset.addEventListener("click", () => {
  state.threshold = initialThreshold
  state.search = ""
  state.above = false
  state.trivial = false
  state.suppressed = false
  state.noCov = false
  state.sort = "score:desc"
  ui.threshold.value = String(state.threshold)
  ui.search.value = ""
  ui.above.checked = false
  ui.trivial.checked = false
  ui.suppressed.checked = false
  ui.noCov.checked = false
  renderAll()
  writeHash()
})

window.addEventListener("hashchange", () => {
  Object.assign(state, readHash(state))
  ui.threshold.value = String(state.threshold)
  ui.search.value = state.search
  ui.above.checked = state.above
  ui.trivial.checked = state.trivial
  ui.suppressed.checked = state.suppressed
  ui.noCov.checked = state.noCov
  renderAll()
})

function initStaticBits() {
  const mode = (meta.mode || "cc").toLowerCase()
  ui.modeBadge.textContent = mode === "crap" ? "CRAP" : "complexity-only"
  ui.modeBadge.classList.toggle("crap", mode === "crap")
  if (meta.coverageSource) {
    const src = meta.coverageSource
    ui.covSource.textContent =
      "Using coverage: " + src.path + (src.hint ? " (" + src.hint + ")" : "")
  }
  const fParts = [
    "ts-crap@" + (meta.version || "?"),
    "node@" + (meta.node || "?"),
    meta.generatedAt || "",
    meta.coverageSource ? "coverage: " + meta.coverageSource.path : "coverage: none",
    meta.command ? "cmd: " + meta.command : "",
  ]
  ui.footer.innerHTML = fParts.filter(Boolean).map((p) => '<div class="row">' + escapeHtml(p) + "</div>").join("")
}

function buildHead() {
  const mode = (meta.mode || "cc").toLowerCase()
  const visible = COLUMNS.filter((c) => !c.showInCrapOnly || mode === "crap")
  ui.theadRow.innerHTML = ""
  for (const col of visible) {
    const th = document.createElement("th")
    th.dataset.key = col.key
    th.scope = "col"
    th.textContent = col.label
    th.tabIndex = 0
    th.setAttribute("role", "columnheader")
    if (col.gloss && glossary[col.gloss]) {
      const g = document.createElement("button")
      g.type = "button"
      g.className = "gloss"
      g.textContent = "?"
      g.setAttribute("aria-label", "Glossary entry for " + col.label)
      g.addEventListener("click", (ev) => {
        ev.stopPropagation()
        openGlossary(col.gloss)
      })
      th.appendChild(document.createTextNode(" "))
      th.appendChild(g)
    }
    th.addEventListener("click", () => toggleSort(col.key))
    th.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        toggleSort(col.key)
      }
    })
    ui.theadRow.appendChild(th)
  }
}

function toggleSort(key) {
  const [curKey, curDir] = state.sort.split(":")
  const dir = curKey === key && curDir === "desc" ? "asc" : "desc"
  state.sort = key + ":" + dir
  renderAll()
  writeHash()
}

function renderAll() {
  const mode = (meta.mode || "cc").toLowerCase()
  const visibleCols = COLUMNS.filter((c) => !c.showInCrapOnly || mode === "crap")

  for (const th of ui.theadRow.querySelectorAll("th")) {
    const [k, d] = state.sort.split(":")
    th.setAttribute("aria-sort", th.dataset.key === k ? (d === "asc" ? "ascending" : "descending") : "none")
  }

  const view = filterEntries(entries, state)
  const sorted = sortEntries(view, state.sort)

  ui.rows.innerHTML = ""
  for (const entry of sorted) {
    const tr = document.createElement("tr")
    if (entry.suppressed) tr.classList.add("suppressed")
    for (const col of visibleCols) {
      tr.appendChild(renderCell(col, entry))
    }
    ui.rows.appendChild(tr)
  }
  ui.thresholdReadout.textContent = thresholdReadout(view, state.threshold)
  ui.summary.innerHTML = summaryPills(view, state.threshold)
}

function renderCell(col, entry) {
  const td = document.createElement("td")
  td.className = col.className
  if (col.key === "severity") {
    const sev = severityAt(entry.score, state.threshold, entry.localThreshold)
    const span = document.createElement("span")
    span.className = "sev-mark " + sev
    span.textContent = sevSymbol(sev)
    span.title = sev
    td.appendChild(span)
    return td
  }
  if (col.key === "score") {
    td.textContent = (entry.score ?? 0).toFixed(1)
    return td
  }
  if (col.key === "complexity" || col.key === "cognitive" || col.key === "sloc") {
    const v = entry[col.key]
    td.textContent = v == null ? "-" : String(v)
    return td
  }
  if (col.key === "coverage") {
    td.appendChild(coverageCell(entry.coverage))
    return td
  }
  if (col.key === "confidence") {
    td.textContent = confSymbol(entry.confidence)
    td.title = entry.confidence
    return td
  }
  if (col.key === "hint") {
    td.textContent = entry.hint ?? ""
    if (entry.hint) td.title = entry.hint
    return td
  }
  if (col.key === "function") {
    td.textContent = entry.function ?? ""
    if (entry.suppressed?.reason) td.title = "Suppressed: " + entry.suppressed.reason
    return td
  }
  if (col.key === "location") {
    td.textContent = (entry.file ?? "") + ":" + (entry.line ?? "")
    return td
  }
  td.textContent = ""
  return td
}

function coverageCell(cov) {
  const wrap = document.createDocumentFragment()
  if (cov == null) {
    wrap.appendChild(document.createTextNode("-"))
    return wrap
  }
  const bar = document.createElement("span")
  bar.className = "bar"
  const fill = document.createElement("span")
  fill.style.width = Math.max(0, Math.min(100, cov)) + "%"
  bar.appendChild(fill)
  wrap.appendChild(bar)
  wrap.appendChild(document.createTextNode(cov.toFixed(1) + "%"))
  return wrap
}

function filterEntries(all, s) {
  const q = s.search.trim().toLowerCase()
  return all.filter((e) => {
    if (s.above && !aboveThreshold(e, s.threshold)) return false
    if (s.trivial && (e.score ?? 0) <= 1) return false
    if (s.suppressed && !e.suppressed) return false
    if (s.noCov && (e.confidence === "none" || e.coverage == null)) return false
    if (q) {
      const haystack = ((e.function || "") + " " + (e.file || "")).toLowerCase()
      if (haystack.indexOf(q) === -1) return false
    }
    return true
  })
}

function aboveThreshold(e, threshold) {
  return (e.score ?? 0) > (e.localThreshold ?? threshold)
}

function sortEntries(list, sortSpec) {
  const [key, dir] = sortSpec.split(":")
  const mult = dir === "asc" ? 1 : -1
  return [...list].sort((a, b) => {
    if (key === "severity") {
      const av = SEVERITY_ORDER.indexOf(severityAt(a.score, state.threshold, a.localThreshold))
      const bv = SEVERITY_ORDER.indexOf(severityAt(b.score, state.threshold, b.localThreshold))
      return mult * (av - bv) || cmpStable(a, b)
    }
    if (key === "function" || key === "location") {
      const av = key === "location" ? (a.file || "") + ":" + (a.line || 0) : a.function || ""
      const bv = key === "location" ? (b.file || "") + ":" + (b.line || 0) : b.function || ""
      return mult * av.localeCompare(bv) || cmpStable(a, b)
    }
    if (key === "confidence") {
      const map = { exact: 2, range: 1, none: 0 }
      return mult * ((map[a.confidence] ?? 0) - (map[b.confidence] ?? 0)) || cmpStable(a, b)
    }
    const av = a[key] == null ? -Infinity : a[key]
    const bv = b[key] == null ? -Infinity : b[key]
    return mult * (av - bv) || cmpStable(a, b)
  })
}

function cmpStable(a, b) {
  return (a.file || "").localeCompare(b.file || "") || (a.line || 0) - (b.line || 0)
}

function thresholdReadout(view, threshold) {
  const total = view.length
  const crappy = view.filter((e) => aboveThreshold(e, threshold)).length
  const pct = total > 0 ? ((crappy / total) * 100).toFixed(0) : "0"
  return "At threshold " + threshold + ": " + crappy + " crappy / " + total + " total (" + pct + "%)"
}

function summaryPills(view, threshold) {
  const counts = { ok: 0, info: 0, warning: 0, error: 0 }
  let sumCC = 0
  let worst = null
  for (const e of view) {
    counts[severityAt(e.score, threshold, e.localThreshold)]++
    sumCC += e.complexity ?? 0
    if (!worst || (e.score ?? 0) > (worst.score ?? 0)) worst = e
  }
  const avgCC = view.length ? (sumCC / view.length).toFixed(1) : "0"
  const worstLabel = worst ? escapeHtml(worst.function) + " (" + (worst.score ?? 0).toFixed(1) + ")" : "-"
  return [
    pill("fn", view.length),
    pill("avg CC", avgCC),
    pill("worst", worstLabel, "raw"),
    pill("error", counts.error, counts.error ? "error" : ""),
    pill("warning", counts.warning, counts.warning ? "warning" : ""),
    pill("info", counts.info),
    pill("threshold", threshold),
  ].join("")
}

function pill(label, value, cls) {
  const mod = cls ? " " + cls : ""
  const html = cls === "raw" ? value : escapeHtml(String(value))
  return (
    '<span class="pill' + mod + '"><span class="v">' + html + '</span><span class="l">' + escapeHtml(label) + "</span></span>"
  )
}

function severityAt(score, threshold, local) {
  const t = typeof local === "number" ? local : threshold
  if (score <= t / 2) return "ok"
  if (score <= t) return "info"
  if (score <= t * 2) return "warning"
  return "error"
}

function sevSymbol(sev) {
  if (sev === "error") return "✖"
  if (sev === "warning") return "!"
  if (sev === "info") return "•"
  return "✓"
}

function confSymbol(c) {
  if (c === "exact") return "●"
  if (c === "range") return "◐"
  return "○"
}

function exportCsv() {
  const mode = (meta.mode || "cc").toLowerCase()
  const visible = COLUMNS.filter((c) => !c.showInCrapOnly || mode === "crap")
  const view = sortEntries(filterEntries(entries, state), state.sort)
  const header = visible.map((c) => csvField(c.label)).join(",")
  const lines = view.map((e) =>
    visible
      .map((c) => {
        if (c.key === "severity") return csvField(severityAt(e.score, state.threshold, e.localThreshold))
        if (c.key === "score") return (e.score ?? 0).toFixed(1)
        if (c.key === "complexity" || c.key === "cognitive" || c.key === "sloc") {
          return e[c.key] == null ? "" : String(e[c.key])
        }
        if (c.key === "coverage") return e.coverage == null ? "" : e.coverage.toFixed(2)
        if (c.key === "confidence") return csvField(e.confidence ?? "")
        if (c.key === "hint") return csvField(e.hint ?? "")
        if (c.key === "function") return csvField(e.function ?? "")
        if (c.key === "location") return csvField((e.file ?? "") + ":" + (e.line ?? ""))
        return ""
      })
      .join(",")
  )
  const blob = new Blob([header + "\n" + lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "ts-crap.csv"
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

function csvField(s) {
  const str = String(s)
  if (/[",\n\r]/.test(str)) return '"' + str.replaceAll('"', '""') + '"'
  return str
}

function openGlossary(key) {
  const g = glossary[key]
  if (!g) return
  ui.glossaryTitle.textContent = g.title || key
  ui.glossaryBody.innerHTML = g.html || escapeHtml(g.text || "")
  ui.glossary.showModal()
}

function readHash(defaults) {
  const out = { ...defaults }
  const h = (location.hash || "").replace(/^#/, "")
  if (!h) return out
  for (const part of h.split("&")) {
    const [rawK, rawV] = part.split("=")
    if (!rawK) continue
    const k = decodeURIComponent(rawK)
    const v = decodeURIComponent(rawV || "")
    if (k === "t") out.threshold = Number(v) || out.threshold
    else if (k === "q") out.search = v
    else if (k === "above") out.above = v === "1"
    else if (k === "trivial") out.trivial = v === "1"
    else if (k === "suppressed") out.suppressed = v === "1"
    else if (k === "nocov") out.noCov = v === "1"
    else if (k === "sort") out.sort = v
  }
  return out
}

function writeHash() {
  const parts = []
  if (state.threshold !== initialThreshold) parts.push("t=" + state.threshold)
  if (state.search) parts.push("q=" + encodeURIComponent(state.search))
  if (state.above) parts.push("above=1")
  if (state.trivial) parts.push("trivial=1")
  if (state.suppressed) parts.push("suppressed=1")
  if (state.noCov) parts.push("nocov=1")
  if (state.sort !== "score:desc") parts.push("sort=" + state.sort)
  history.replaceState(null, "", parts.length ? "#" + parts.join("&") : location.pathname + location.search)
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}
