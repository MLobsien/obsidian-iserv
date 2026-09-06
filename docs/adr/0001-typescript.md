# ADR-0001: TypeScript with esbuild

## Status
Accepted

## Context
The original plugin was a single 1094-line `main.js` with no type safety, no modularity, and no build pipeline. As features grew (queue, exams, mails, PDF), the file became unmanageable.

## Decision
- **TypeScript** for type safety and modularity
- **esbuild** for fast bundling to single `main.js`
- **No dist directory** — GitHub releases for distribution
- **vitest** for testing (fast, native ESM/TypeScript support)

## Consequences
- Type errors caught at compile time, not in Obsidian console
- Multiple source files (`src/`) compiled to single output
- `npm run build` → `main.js` at repo root
- `npm run test` → vitest with TypeScript support