# Architecture

Technical overview for contributors and extenders. User-facing usage lives in [`README.md`](../../README.md).

**ts-anti-patterns defaults to CC-only mode**, so it stays useful even when no coverage data is available. See [`cargo-crap`](https://github.com/minikin/cargo-crap) for the Rust counterpart.

## Goals and non-goals

### Goals

- One npm package: `npm i -g ts-anti-patterns` or `npx ts-anti-patterns@latest`.
- Zero-arg run without LCOV is useful on any TS/JS project.
- When coverage exists (LCOV, Istanbul JSON, Clover, Cobertura), upgrade to full CRAP scoring.
- Rich HTML report and format parity with cargo-crap where it makes sense.
- CLI and library (`import { analyze } from "ts-anti-patterns"`).

### Non-goals

- No custom TS parser - `@typescript-eslint/typescript-estree`.
- No bundled test runner - users generate coverage (`--full` / `--run-coverage` optional).
- No Babel/Vite/Vitest patches. Passive, standalone tool.
- No web server. HTML is a static single file.

## Operating modes

| Command | Behavior |
|---|---|
| `ts-anti-patterns` | Scan `./src` (or `.` if no `src`). CC-only by default. |
| `ts-anti-patterns --cov` | Auto-detect `coverage/*` and score CRAP. |
| `ts-anti-patterns --full` | Generate coverage (best effort), then CRAP. |
| `ts-anti-patterns ./src` | Explicit root. |
| `ts-anti-patterns --no-cov` | Force CC-only, ignore coverage. |
| `ts-anti-patterns --lcov F` | Require file `F`; exit 2 if missing. |
| `ts-anti-patterns --format html` | Change output format. |
| `ts-anti-patterns --fail-above` | CI gate on final score (CC or CRAP). |

`threshold` gates the **final score** (CRAP when coverage is active, else CC). In CC-only mode, hide Coverage/Conf columns; header shows `mode: complexity-only`.

## Quality decisions (beyond cargo-crap)

1. **Cognitive complexity** (Sonar-style) next to CC.
2. **SLOC** - density vs length.
3. **Branch coverage from BRDA** when LCOV provides it.
4. **Source maps** for transpiled coverage (`dist` -> `src`).
5. **Confidence** (`●` exact / `◐` range / `○` none).
6. **Class-qualified names** (`UserCard.render`, `Cache#size`, `<arrow@42>`).
7. **Severity** bands in SARIF, GitHub, HTML, PR comment.
8. **Actionable hints** - deterministic rules, no LLM.
9. **In-source pragmas** - `// ts-anti-patterns-ignore`, `// ts-anti-patterns-threshold N`.
10. **Reproducibility footer** + `--diagnose`.
11. **HTML threshold slider**, glossary popovers, CSV export, dark mode.
12. **`ts-anti-patterns explain`** matches HTML glossary.
13. **Stable sort** and canonical JSON keys for baselines.

## Repository layout

```
ts-anti-patterns/
├── src/
│   ├── cli.ts              # CLI entry
│   ├── index.ts            # programmatic API
│   ├── complexity.ts       # CC + names + SLOC
│   ├── cognitive.ts
│   ├── coverage/           # lcov, json-summary, clover, cobertura
│   ├── merge.ts            # metrics + coverage
│   ├── score.ts, hints.ts, delta.ts, diagnose.ts
│   ├── report/             # human, json, html, markdown, github, sarif, pr-comment
├── test/
├── schemas/report-v1.json, schemas/delta-v1.json
├── examples/               # GitHub Actions, lefthook
└── scripts/copy-assets.mjs
```

## Core types

See `src/options.ts`: `FunctionMetric`, `CrapEntry`, `ResolvedOptions`, `ReportMeta`.

- `FunctionMetric` - per-function CC, cognitive, SLOC, pragmas.
- `CrapEntry` - adds coverage, score, mode (`crap` | `cc`), severity, hint.
- `ResolvedOptions` - merged CLI + config + defaults.

## Pipeline

```
1. parse CLI + loadConfig -> ResolvedOptions
2. optional: generate coverage (--full / --run-coverage)
3. collect files (walker)
4. analyze metrics (parallel via p-limit)
5. load coverage unless noCov; merge -> CrapEntry[]
6. optional baseline diff
7. render format; write stdout or --output
8. exit: failAbove / failRegression / errors
```

Keep layers separate: `complexity` must not import `report`, etc.

## HTML report

Single self-contained `.html`, no network. Data inlined as JSON in the template.

Features: sortable table, threshold slider, search, toggles (above threshold, trivial, suppressed, no-coverage), severity colors, coverage bar, URL hash state, glossary, CSV export, dark mode, print CSS.

## cargo-crap parity

| Feature | ts-anti-patterns |
|---|---|
| `--lcov` | yes + auto-detect via `--cov` |
| `--threshold`, `--top`, `--min` | yes (default `--top 20`) |
| `--missing` policies | yes |
| `--exclude` / `--allow` | yes + `.gitignore` |
| Formats human/json/markdown/github/sarif/pr-comment/html | yes |
| `--baseline`, `--fail-regression` | yes |
| `--workspace`, `--watch`, `--jobs` | yes |
| Cognitive, SLOC, branch coverage, source maps | ts-anti-patterns only |
| Confidence, severity, hints, pragmas, diagnose, explain, init | ts-anti-patterns only |
| One-command `--full` | ts-anti-patterns only |

## Defaults

| Topic | Default |
|---|---|
| `??` in CC | off (`--count-nullish-coalescing`) |
| Default path | `./src` if present, else `.` |
| Threshold | 30 (same scale in CC and CRAP) |
| Coverage | off unless `--cov`, `--full`, or explicit path |
| Top rows | 20 |
| Branch coverage | use when BRDA present |
| Cognitive / hints | on (`--no-cognitive`, `--no-hints` to disable) |
| Config | cosmiconfig: `.ts-anti-patterns.json`, etc. |
| Node | >= 18 |

## Edge cases

- **Multiple positional paths:** walker dedupes; display paths relative to common ancestor.
- **Anonymous functions:** `<arrow@line>` / `<fn@line>`; `--skip-anonymous` hides them.
- **Tiny functions:** shown by default; HTML toggle hides score=1.
- **TypeScript:** optional chaining +1; decorators skipped; ambient/declare ignored; type-only files excluded.
