# Contributing

## Setup

```bash
npm i
npm run build
npm test
```

Before a PR:

```bash
npm run lint
npm run typecheck
npm run build
npm test
node dist/cli.js ./src --threshold 30
```

## Tests

| Layer | What |
|---|---|
| Unit | complexity, cognitive, pragmas, score, merge, lcov, coverage formats, hints, delta, formats, html (JSDOM) |
| Property | CC monotonicity (`fast-check`) |
| E2E | CLI paths, coverage, fail-above, formats, skill subcommands |

Schemas in `schemas/report-v1.json` and `schemas/delta-v1.json` are a public contract - prefer additive changes after 1.x.

## Definition of done

- Tests, lint, and typecheck pass.
- README updated if CLI behavior or defaults changed.
- Do not commit `dist/` (built in CI and via `prepack` on publish).
- Layer boundaries respected (`complexity` does not import `report`, etc.).

## Release smoke checklist

1. `npx ts-anti-patterns` on a project without coverage - CC table, top 20, footer.
2. `npx ts-anti-patterns --cov` or `--full` - CRAP when coverage exists.
3. `npx ts-anti-patterns --format html -o report.html` - opens offline.
4. `--baseline` + `--fail-regression` gates regressions.
5. `npm pack --dry-run` includes `dist/` and `schemas/`.

Publishing is automated via [`../workflows/publish.yml`](../workflows/publish.yml) (tag `v*` must match `package.json` version).
