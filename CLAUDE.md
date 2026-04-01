# CLAUDE.md — Sering Project Tracker (Rewrite Guide)

## What This Project Is
Project tracker for De Sering community kitchen. Small user base (< 100 users), admin + visitor roles, real-time updates via SSE. Hosted on Railway with PostgreSQL.

## Rewrite Goals
This codebase is being rewritten phase-by-phase. The API contract and database models stay the same, but the internals are being rebuilt for correctness, testability, and safety. Each phase below should be completed in order. Mark phases as DONE here as they're finished.

### Phase Status
- [x] Phase 1: Schema hardening (enums, constraints, indexes, migration)
- [x] Phase 2: Shared backend infrastructure (validation, CRUD factory, config)
- [x] Phase 3a: Simple route rewrites (groups, announcements, comments, health)
- [x] Phase 3b: Complex route rewrites (projects, tasks)
- [x] Phase 3c: Remaining routes (media, shopping, reports, export)
- [x] Phase 4: Auth hardening
- [x] Phase 5a: Frontend core (state, utils, auth)
- [x] Phase 5b: Frontend screens (dashboard, projects)
- [x] Phase 5c: Frontend remaining (shopping, budget, admin, reports, sse, init)
- [x] Phase 6: Integration tests + hardening
- [x] Phase 7: TypeScript migration (backend ESM + frontend module:None)
- [x] Phase 8: Type safety hardening (eliminate `any`, typed error handling, audit logging gaps)

---

## Stack
- **TypeScript** throughout (backend + frontend), compiled with `tsc`
- Node.js / Express 5 (ESM, `"type": "module"`)
- Frontend TypeScript compiled with `module: "None"` — outputs standalone JS files, NO bundler
- PostgreSQL via Prisma ORM (with generated types)
- Zod validation with `z.infer<>` type exports
- Google Sign-In for admin auth; visitors enter a name (no login)
- Quill.js rich text editor (CDN)
- sanitize-html on server
- SSE for real-time (no socket.io, no external deps)
- Railway hosting (auto-deploy, Postgres plugin)
- Dev via `tsx --watch`, production via `node dist/start.js`

## Hard Rules — Do Not Break These
- **No bundler.** No webpack, vite, esbuild, rollup. `tsc` is the only build step.
- **No import/export in frontend TS files.** Frontend source is in `src/frontend/`, compiled to `public/js/` with `module: "None"`. All declarations are global. Use `var` for top-level declarations.
- **No new npm dependencies** without explicit approval. The dep list is intentionally small.
- **Every Prisma schema change requires a migration.** Use `npx prisma migrate dev --name <descriptive_name>`.
- **Never remove `asyncHandler()` wrapping** from route handlers.
- **Never bypass `sanitize()`** for user-provided HTML content.
- **Script load order in index.html must be preserved:** `state.js` -> `events.js` -> `auth.js` -> `utils.js` -> `media.js` -> `comments.js` -> `dashboard.js` -> `projects.js` -> `shopping.js` -> `budget.js` -> `reports.js` -> `admin.js` -> `sse.js` -> `init.js`
- **Always run `npm run build` after editing TS files.** Backend compiles to `dist/`, frontend compiles to `public/js/`.

---

## Architecture Patterns (NEW — follow these in all new/rewritten code)

### Backend

#### Validation: Use Zod
- Add `zod` as a dependency (the ONE allowed new dep).
- Define schemas in `src/lib/schemas.ts` — one `create` and one `update` schema per entity.
- Schemas must match Prisma enums exactly. Single source of truth.
- All route handlers validate with `schema.parse(req.body)` inside a try/catch that returns 400 on ZodError.
- `src/lib/validate.ts` still provides UUID validation and `stripTags()` used across routes.

#### CRUD Factory: `src/lib/crud.ts`
- Create a factory function: `makeCrud({ model, createSchema, updateSchema, include?, broadcast? })`
- Factory returns standard Express handlers: `list`, `getById`, `create`, `update`, `softDelete`, `approve`
- Every `list` handler supports pagination: `?cursor=<id>&limit=50` (cursor-based, default 50, max 200).
- Every `list` handler filters `deletedAt: null` by default.
- Every mutation handler broadcasts SSE via `broadcast()` and logs via `logAction()`.
- Routes that need custom logic (e.g., projects with task counts) extend the factory, not bypass it.

#### Queries: Fix N+1 and Unbounded Fetches
- Use Prisma `_count` for status aggregations — never fetch full child arrays just to count.
- All list endpoints MUST be paginated. No exceptions.
- Export endpoint must stream rows, not load all into memory.
- Use transactions for multi-step mutations (approve + update, reorder, group delete with checks).

#### Config: Centralize in `src/lib/config.ts`
- All magic numbers become named constants: `RATE_LIMIT_GENERAL`, `RATE_LIMIT_WRITES`, `MAX_IMAGE_SIZE_MB`, `SSE_HEARTBEAT_MS`, `MAX_SSE_CONNECTIONS`, etc.
- `SESSION_SECRET` must **crash the process** in production if not set. No fallback.
- `DEV_MODE` must check `NODE_ENV !== 'production'` AND `!GOOGLE_CLIENT_ID`. Both conditions required.

#### Auth: Lock Down Dev Mode
- `/auth/dev-login` must return 403 if `NODE_ENV === 'production'`, regardless of other config.
- Add rate limiting to auth endpoints: 5 requests/minute.

#### SSE: Fix Connection Issues
- Add per-connection idle timeout (5 minutes with no heartbeat ACK = drop).
- Replace in-memory comment cooldown map with a simple DB check (last comment by authorName in last N seconds).
- Storage cap check: use atomic `UPDATE ... RETURNING` or a serializable transaction, not check-then-act.

#### Error Responses: Consistent Shape
```json
{ "error": "Human readable message", "code": "VALIDATION_ERROR" }
```
Use codes: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `INTERNAL_ERROR`.

#### Error Handling: Type-Safe Patterns
- All `catch` blocks use `catch (err: unknown)` — never `catch (err: any)`.
- Use `isPrismaNotFound(err)` from `errors.ts` to check for Prisma P2025 (record not found).
- Use `handleZodError(err, res)` for Zod validation errors.
- Dynamic Prisma model access uses `getPrismaDelegate(name)` from `db.ts` — never `(prisma as any)[model]`.
- Transaction callbacks use `TransactionClient` type from `db.ts` — never `tx: any`.
- All mutation endpoints must call `logAction()` for audit trail.

### Frontend

#### XSS Prevention: `html` Tagged Template
- Define in `utils.js`: a tagged template literal `html` that auto-escapes interpolated values.
- ALL innerHTML assignments must use `html\`...\`` — never raw template literals.
- Raw HTML from Quill (already sanitized server-side) can use a `raw()` wrapper that opts out of escaping.
- This is the #1 frontend safety improvement. Every screen file must use it.

#### State: Reactive `S` Object
- `state.js` adds a `S.subscribe(key, callback)` method.
- When `S[key]` changes, all subscribers are notified.
- Screen render functions subscribe to relevant keys instead of being called imperatively from 15 different places.
- SSE handlers in `sse.js` ONLY update `S` — they never call render functions directly. Subscribers handle re-rendering.
- This replaces the current spaghetti of `rerenderTaskList()`, `_refreshGroupsAndRerender()`, etc.

#### Mutation IDs: Use Crypto
- Replace `Date.now() + Math.random()` with `crypto.getRandomValues()` for mutation ID generation.

#### DOM Updates: Targeted, Not Full Redraws
- Each screen render function should render once on mount.
- Subsequent updates use targeted DOM patches triggered by `S.subscribe()`.
- Full re-render only on screen navigation change.

### Database Schema Changes (Phase 1)

#### Prisma Enums
```prisma
enum ProjectTier { mvp medium next_level }
enum JoinType { open contact closed }
enum CommentTargetType { group project task announcement }
enum MediaParentType { task project announcement comment }
enum MediaType { photo voice }
```
These enums exist as PostgreSQL enum types in production and are used in the Prisma schema.

**Now enforced as PostgreSQL enums** (migration `20260329000000_enforce_enums_decimal`):
- `Project.status` uses `ProjectStatus` enum
- `Task.status` uses `TaskStatus` enum
- `ShoppingItem.type` uses `ShoppingItemType` enum
- `ShoppingItem.pricePerItem` and `ShoppingItem.amount` are `Decimal(10,2)` (not Float)
- `Project.groupId` has `onDelete: Restrict` (prevents deleting groups with projects)

#### Add Missing Indexes
- `Task(projectId, status)` compound index
- `ShoppingItem(projectId, approved)` compound index
- `Media(parentType, parentId, createdAt)` compound index

#### Keep the Same Model Names and Relations
The API contract does not change. Frontend expects the same JSON shapes. Enum values serialize as strings in JSON automatically.

---

## Testing (NEW)

### Setup
- Add `vitest` + `supertest` as dev dependencies.
- Add `"test": "vitest run"` and `"test:watch": "vitest"` to package.json scripts.
- Test files go next to the source: `src/routes/tasks.test.ts`, `src/lib/crud.test.ts`, etc.

### What to Test
- Every Zod schema: valid input, invalid input, edge cases.
- CRUD factory: list pagination, soft-delete filtering, SSE broadcast calls.
- Auth: dev-login blocked in production, admin middleware rejects visitors.
- Business logic: approval workflows, task status transitions, shopping approval.
- Integration: supertest against real Express app with test database.

### What NOT to Test
- Prisma queries (trust the ORM).
- CSS / visual rendering.
- Third-party libraries (Quill, sanitize-html).

---

## Project Structure
```
tsconfig.json                  — Project references root
tsconfig.backend.json          — ES2022, Node16, outDir: dist/
tsconfig.frontend.json         — ES2020, module: None, outDir: public/js/
tsconfig.test.json             — Extends backend, includes vitest/globals types
vitest.config.ts               — Test configuration
src/
  server.ts                    — Express app, middleware, route mounting (exports app)
  start.ts                     — app.listen() entry point
  types/
    express-session.d.ts       — Session augmentation (admin, email, name)
  lib/
    config.ts                  — All env vars + named constants (centralized)
    db.ts                      — Prisma client, getPrismaDelegate(), TransactionClient type
    schemas.ts                 — Zod validation schemas + z.infer<> type exports
    crud.ts                    — CRUD factory (list/get/create/update/delete/approve)
    errors.ts                  — Error helpers (sendError, handleZodError, isPrismaNotFound)
    sanitize.ts                — HTML sanitization (sanitize-html allowlist)
    validate.ts                — UUID validation, stripTags, validateId middleware
    async-handler.ts           — Wraps async route handlers
    media-utils.ts             — File deletion utility
    sse.ts                     — SSE broadcast hub (connection management, heartbeat)
    audit.ts                   — Audit logging (fire-and-forget to DB)
  routes/
    auth.ts                    — Google Sign-In, dev login, requireAdmin middleware
    groups.ts                  — Group CRUD (uses crud factory)
    projects.ts                — Project CRUD + task counts via _count
    tasks.ts                   — Task CRUD within projects
    announcements.ts           — Announcement CRUD (admin only)
    comments.ts                — Comment CRUD (anyone posts, admin deletes)
    shopping.ts                — Shopping list CRUD (items + costs)
    media.ts                   — File upload/serve/delete
    reports.ts                 — Problem reports
    export.ts                  — Streaming CSV export (admin only)
    health.ts                  — Health check
    _test-helpers.ts           — Shared test utilities
    *.test.ts                  — Co-located test files
  frontend/
    globals.d.ts               — External lib declarations (Quill, google, html2canvas)
    state.ts                   — Global S with subscribe() reactivity
    events.ts                  — Custom event bus (EventTarget-based pub/sub)
    auth.ts                    — Google Sign-In, dev login, name overlay
    utils.ts                   — html`` tagged template, apiFetch, toast, helpers
    media.ts                   — Photo upload, voice recording, lightbox
    comments.ts                — Comment rendering + posting
    dashboard.ts               — Dashboard screen + announcement detail page (#announcement/:id)
    projects.ts                — Project list + detail
    shopping.ts                — Shopping list UI
    budget.ts                  — Budget overview
    reports.ts                 — Report button + modal
    admin.ts                   — Admin panel
    sse.ts                     — SSE handlers (update S only, no direct DOM)
    init.ts                    — Navigation, routing, bootstrap (LAST)
dist/                          — Compiled backend (gitignored)
public/
  index.html                   — Shell HTML + name overlay
  css/                         — Stylesheets
  js/                          — Compiled frontend (output from src/frontend/)
  fonts/                       — Self-hosted Overused Grotesk variable font
prisma/
  schema.prisma                — Database schema with enums
  migrations/                  — Prisma migrations
uploads/                       — User-uploaded media (gitignored)
```

## Running
```bash
npm run build         # tsc --build (compiles backend + frontend)
npm run dev           # tsx --watch src/start.ts (port 3001)
npm start             # node dist/start.js (production)
npm run typecheck     # tsc --build --noEmit
npm test              # vitest run
npm run test:watch    # vitest
```

### Required Environment Variables
| Variable | Required In | Purpose |
|---|---|---|
| `DATABASE_URL` | always | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | production | Google OAuth client ID |
| `SESSION_SECRET` | production | Session cookie signing (must crash if missing) |
| `ADMIN_EMAILS` | production | Comma-separated admin email list |

### Dev Mode
Without `GOOGLE_CLIENT_ID` AND with `NODE_ENV !== 'production'`, the app runs in dev mode. Use `/auth/dev-login` to get admin access.

## Key Data Flow (unchanged)
The API contract stays the same. Same endpoints, same JSON shapes, same SSE events. The only additions are:
- Pagination params (`?cursor=<id>&limit=50`) on all list endpoints
- Consistent error response shape (`{ error, code }`)

## Frontend Hash Routing
Hash routes handled in `init.ts → handleRoute()`:
- `#dashboard` — dashboard screen (announcements + project overview)
- `#projects` — project list screen
- `#project/:id` — project detail (sets `S.currentProjectId`, renders via `renderProjects()`)
- `#announcement/:id` — announcement detail (sets `S.currentAnnouncementId`, renders via `renderDashboard() → renderAnnouncementDetail()`)
- `#budget`, `#admin` — other screens

State keys to clear on navigation: `currentProjectId`, `currentProject`, `currentAnnouncementId`.

## Security Checklist
- [x] Helmet (CSP, HSTS, X-Frame-Options, nosniff)
- [x] CSRF double-submit cookie
- [x] Rate limiting (general + writes + uploads + SSE + auth)
- [x] Input sanitization (stripTags, sanitize-html)
- [x] URL validation (http/https only)
- [x] Dev login blocked in production (Phase 4)
- [x] Session secret crash in production (Phase 2)
- [x] html`` tagged template for XSS prevention (Phase 5a)
- [x] crypto.getRandomValues for mutation IDs (Phase 5a)
- [x] Atomic storage cap checks (serializable transaction in media upload)
- [x] Comment body HTML stripped server-side
- [x] Media upload validates parent entity exists
- [x] Soft-deleted records cannot be updated via PATCH
- [x] SSE graceful shutdown (clears heartbeat, closes connections, orders Prisma disconnect)
- [x] SSE reconnects with exponential backoff (never gives up permanently)
- [x] Keyboard focus-visible styles on all interactive elements
- [x] prefers-reduced-motion support
- [x] WCAG AA contrast compliance
