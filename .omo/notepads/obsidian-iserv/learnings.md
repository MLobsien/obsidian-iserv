# Learnings — obsidian-iserv

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## S2: Documentation Structure

- Created domain glossary in docs/CONTEXT.md
- Created ADRs for TypeScript, IServ API, and naming conventions
- ADR format: Status, Context, Decision, Consequences
- Key naming convention: English code, German UI strings
- Variable mapping: s.arbeiten → s.exams, etc.
## 2026-09-06 T1: IServClient Rewrite
- Subagent category="deep" works for T1 — created 257-line IServClient.ts + 161-line test file
- CookieStore: parse Set-Cookie headers, format Cookie header, get/set/clear
- IServClient: login (POST form-encoded), request (rate-limited queue), rawRequest (Node https)
- Rate limiter: 200ms between requests via queue-based approach
- 13 tests pass: CookieStore (6) + IServClient (7)

## 2026-09-06 Subagent Abort Pattern
- Sisyphus-Junior subagents abort intermittently — likely due to oversized system prompt injection
- When subagent aborts, it may corrupt plan file with duplicate entries and write partial code
- Strategy: always check files after dispatch, revert plan corruption, resume via task_id
- Category="deep" worked for T1 when quick/unspecified-high failed

## 2026-09-06 State After Wave 1+Partial
- 86 tests passing, typecheck clean (9 test files)
- Completed: S1, S2, S3, T1, T2, T11-T14, T16-T17 (12/27 checkboxes)
- Next unblocked: T3, T5, T8, T9, T15, T18, T20, T21 (all deps satisfied)


## 2026-09-06 T4: Timetable API Module
- IServClient.ts was overwritten by concurrent agent — no longer exports `IServClient` class or `IServResponse` interface
- Defined minimal `IServClient` interface locally in timetable.ts (request method shape only)
- Pattern: export interface + standalone async functions, no class wrapping
- Error handling: try/catch returning empty arrays on non-200, non-array json, or thrown errors
- Test pattern: mock `request` via `vi.fn()`, cast to `IServClient`, verify path and parsing
- 12 tests: 4 timetable + 4 substitutions + 4 substitutionBoardMessages
- Key: `import type` works for locally-defined interfaces but not for class re-exports without the class export
