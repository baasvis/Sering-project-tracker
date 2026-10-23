# DECISIONS.md — Sering Project Tracker

Dated history. Only added to; a newer entry replaces an older one by naming it.

### 2026-03 to 2026-04 — The phase-by-phase rewrite (finished)
The codebase was rewritten in phases with the API contract and database models kept the same,
rebuilding the internals for correctness, testability and safety. All phases are done:
1. Schema hardening (enums, constraints, indexes, migration).
2. Shared backend infrastructure (validation, CRUD factory, config).
3. Route rewrites: 3a simple (groups, announcements, comments, health), 3b complex (projects,
   tasks), 3c remaining (media, shopping, reports, export).
4. Auth hardening.
5. Frontend: 5a core (state, utils, auth), 5b screens (dashboard, projects), 5c remaining
   (shopping, budget, admin, reports, sse, init).
6. Integration tests and hardening.
7. TypeScript migration (backend ESM, frontend `module: None`).
8. Type safety hardening (no `any`, typed error handling, audit logging gaps).
Zod was the one new dependency the rewrite allowed; vitest and supertest came in for the tests.
Enums became real PostgreSQL enums in migration `20260329000000_enforce_enums_decimal`.

### 2026-10-23 — Shared rules adopted
CLAUDE.md now carries the shared rules for all of Daan's code repositories (decided by Daan,
23 Oct 2026; master copy in `baasvis/desering-claude-plugins`) and describes the rewrite's
patterns as the current rules. `prisma migrate dev` was replaced by hand-written migrations
applied with `prisma migrate deploy` (shared rule S14).
