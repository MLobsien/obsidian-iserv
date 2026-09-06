# Decisions — obsidian-iserv

Architectural choices and rationales discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## S2: Documentation Decisions

- TypeScript + esbuild for type safety and fast bundling
- No dist directory — GitHub releases for distribution
- vitest for testing (fast, native ESM/TypeScript support)
- Node.js https module for full cookie control (Obsidian requestUrl swallows Set-Cookie)
- English code, German UI strings
