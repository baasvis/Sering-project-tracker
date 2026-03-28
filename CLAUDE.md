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
- [ ] Phase 5b: Frontend screens (dashboard, projects)
- [ ] Phase 5c: Frontend remaining (shopping, budget, admin, reports, sse, init)
- [ ] Phase 6: Integration tests + hardening

---

## Stack (unchanged)
- Node.js / Express 5, vanilla JS frontend (NO build step, NO bundler)
- PostgreSQL via Prisma ORM
- Google Sign-In for admin auth; visitors enter a name (no login)
- Quill.js rich text editor (CDN)
- sanitize-html on server
- SSE for real-time (no socket.io, no external deps)
- Railway hosting (auto-deploy, Postgres plugin)

## Hard Rules — Do Not Break These
- **No build step or bundler.** No webpack, vite, esbuild, rollup. Ever.
- **No import/export in frontend files.** All frontend JS uses `<script>` tags, all functions are global.
- **No new npm dependencies** without explicit approval. The dep list is intentionally small.
- **Every Prisma schema change requires a migration.** Use `npx prisma migrate dev --name <descriptive_name>`.
- **Never remove `asyncHandler()` wrapping** from route handlers.
- **Never bypass `sanitize()`** for user-provided HTML content.
- **Script load order in index.html must be preserved:** `state.js` -> `auth.js` -> `utils.js` -> `media.js` -> `comments.js` -> `dashboard.js` -> `projects.js` -> `shopping.js` -> `budget.js` -> `reports.js` -> `admin.js` -> `sse.js` -> `init.js`

---

## Architecture Patterns (NEW — follow these in all new/rewritten code)

### Backend

#### Validation: Use Zod
- Add `zod` as a dependency (the ONE allowed new dep).
- Define schemas in `lib/schemas.js` — one `create` and one `update` schema per entity.
- Schemas must match Prisma enums exactly. Single source of truth.
- All route handlers validate with `schema.parse(req.body)` inside a try/catch that returns 400 on ZodError.
- Delete the old `lib/validate.js` once all routes are migrated.

#### CRUD Factory: `lib/crud.js`
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

#### Config: Centralize in `lib/config.js`
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

#### Add Prisma Enums
```prisma
enum ProjectStatus { active completed archived }
enum TaskStatus { todo in_progress done }
enum ProjectTier { mvp medium next_level }
enum JoinType { open contact closed }
enum ShoppingItemType { product cost }
enum MediaType { photo voice }
enum CommentTargetType { group project task announcement }
enum MediaParentType { task project announcement comment }
```
Replace all `String` type fields with these enums.

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
- Test files go next to the source: `routes/tasks.test.js`, `lib/crud.test.js`, etc.

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

## Project Structure (Target)
```
server.js                 — Express app, middleware, route mounting
lib/
  config.js               — All env vars + named constants (centralized)
  db.js                   — Prisma client instance
  schemas.js              — Zod validation schemas (one per entity)
  crud.js                 — CRUD factory (list/get/create/update/delete/approve)
  sanitize.js             — HTML sanitization (sanitize-html allowlist)
  async-handler.js        — Wraps async route handlers
  media-utils.js          — File deletion utility
  sse.js                  — SSE broadcast hub (connection management, heartbeat)
  audit.js                — Audit logging (fire-and-forget to DB)
routes/
  auth.js                 — Google Sign-In, dev login, requireAdmin middleware
  groups.js               — Group CRUD (uses crud factory)
  projects.js             — Project CRUD + task counts via _count
  tasks.js                — Task CRUD within projects
  announcements.js        — Announcement CRUD (admin only)
  comments.js             — Comment CRUD (anyone posts, admin deletes)
  shopping.js             — Shopping list CRUD (items + costs)
  media.js                — File upload/serve/delete
  reports.js              — Problem reports
  export.js               — Streaming CSV export (admin only)
  health.js               — Health check
  *.test.js               — Co-located test files
public/
  index.html              — Shell HTML + name overlay
  css/                    — Same structure, no changes planned
  js/
    state.js              — Global S with subscribe() reactivity
    auth.js               — Google Sign-In, dev login, name overlay
    utils.js              — html`` tagged template, apiFetch, toast, helpers
    media.js              — Photo upload, voice recording, lightbox
    comments.js           — Comment rendering + posting
    dashboard.js          — Dashboard screen
    projects.js           — Project list + detail
    shopping.js           — Shopping list UI
    budget.js             — Budget overview
    reports.js            — Report button + modal
    admin.js              — Admin panel
    sse.js                — SSE handlers (update S only, no direct DOM)
    init.js               — Navigation, routing, bootstrap (LAST)
prisma/
  schema.prisma           — Database schema with enums
  migrations/             — Prisma migrations
```

## Running
```bash
npm run dev           # port 3001 with --watch
npm start             # production
npm test              # vitest
npm run test:watch    # vitest in watch mode
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
- [ ] Atomic storage cap checks (Phase 3c)
