---
name: ts-crap
description: Use when the user asks for CRAP/complexity analysis, risk scoring, or top risky TypeScript/JavaScript functions.
---

# ts-crap - Risk and Complexity Analysis

Use `ts-crap` to find risky functions by combining cyclomatic complexity with optional test coverage.

## Fast paths

- **CC-only (default):** `npx ts-crap@latest ./src`
- **Full CRAP:** `npx ts-crap@latest --full`
- **HTML report:** `npx ts-crap@latest ./src --format html --output crap-report.html`
- **Top offenders:** default shows top 20 (`--top 20`)

## CI

- `npx ts-crap@latest ./src --threshold 30 --fail-above --summary`
- `npx ts-crap@latest --cov --baseline baseline.json --fail-regression --format json`

## Notes

- Default mode is CC-only (coverage off unless `--cov`, `--full`, or `--lcov`).
- Use `--coverage-command "<cmd>"` when tests need a custom runner command.
