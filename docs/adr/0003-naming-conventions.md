# ADR-0003: Naming Conventions

## Status
Accepted

## Context
Code and user-facing strings need different language conventions.

## Decision
- **Code**: English (variables, functions, classes, comments)
- **User-facing Strings**: German (notices, UI labels, empty states)
- Variable mapping:
  - `s.arbeiten` → `s.exams`
  - `Vorbereitungsfenster` → `Prep Window`
  - `Lernplan` → `Study Plan`
  - `Fachindex` → `Subject Index`

## Consequences
- Consistent codebase in English
- German UI for German users
- Clear separation of concerns