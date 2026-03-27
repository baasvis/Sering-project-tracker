# CLAUDE.md — Sering Project Tracker

## Stack
- Node.js/Express server, vanilla JS frontend (no build step, no bundler)
- All frontend JS files loaded as `<script>` tags — functions are global
- PostgreSQL database via Prisma ORM
- Google Sign-In for admin auth (JWT verified via google-auth-library); visitors enter a name (no login)
- Quill.js rich text editor for descriptions (loaded from CDN)
- HTML sanitization via sanitize-html on the server
- Hosted on Railway (auto-deploy, Postgres plugin)

## Project Structure
```
server.js              — Express app entry point, mounts routers
lib/
  config.js            — Configuration, env vars, admin email list
  db.js                — Prisma client instance
  sanitize.js          — HTML sanitization for rich text (allowlist-based)
  async-handler.js     — Wraps async route handlers for error propagation
  media-utils.js       — Shared file deletion utility
routes/
  auth.js              — Google Sign-In (admin), dev login, requireAdmin middleware
  groups.js            — Group CRUD with task status counts
  projects.js          — Project CRUD with group relations, tier, joinType
  tasks.js             — Task CRUD within projects
  announcements.js     — Announcement CRUD (admin only), includes media inline
  comments.js          — Comment CRUD (anyone can post, admin can delete)
  shopping.js          — Shopping list CRUD (items + costs per project)
  media.js             — File upload/serve/delete (photos + voice notes)
  export.js            — Admin data export (ZIP of CSVs)
  health.js            — Health check endpoint
public/
  index.html           — Shell HTML + name overlay
  css/
    base.css           — Variables, resets, layout, brand styles, Quill overrides
    dashboard.css      — Dashboard + announcements + carousel
    projects.css       — Project list + detail + tasks
    comments.css       — Comment threads
    media.css          — Media display, voice recorder, lightbox
    shopping.css       — Shopping list table + budget page
    admin.css          — Admin panel
    mobile.css         — Responsive overrides
  js/
    state.js           — Constants (NAV_SCREENS, TASK_STATUSES, PROJECT_TIERS, JOIN_TYPES), global state S
    auth.js            — Google Sign-In, dev login, name overlay
    utils.js           — API helpers, toast, esc, timeAgo, Quill editor helpers, showLoading, withDedup
    media.js           — Photo upload, voice recording, lightbox, media delete
    comments.js        — Comment rendering + posting (with dedup)
    dashboard.js       — Dashboard screen (announcements with carousel + project overview)
    projects.js        — Project list, project detail, task list, modals, targeted re-renders
    shopping.js        — Shopping list UI per project
    budget.js          — Budget overview screen
    admin.js           — Admin panel (group management, data export)
    init.js            — Navigation, routing, app bootstrap (MUST load last)
prisma/
  schema.prisma        — Database schema
uploads/               — User-uploaded media files (gitignored)
```

## Script Load Order
Scripts must load in the order listed in index.html:
`state.js` → `auth.js` → `utils.js` → `media.js` → `comments.js` → `dashboard.js` → `projects.js` → `shopping.js` → `budget.js` → `admin.js` → `init.js` (last)

## Conventions
- All frontend functions are global (no modules, no import/export)
- State lives in the global `S` object (defined in state.js)
- Each screen has a render function: `renderDashboard()`, `renderProjects()`, `renderBudget()`, `renderAdmin()`
- `renderCurrentScreen()` dispatches to the active screen
- Hash-based routing: `#dashboard`, `#projects`, `#budget`, `#admin`, `#project/{id}`
- Two auth tiers: admin (Google Sign-In) and visitor (name in localStorage)
- Admin-only actions use `requireAdmin` middleware server-side
- All async route handlers wrapped in `asyncHandler()` for error propagation
- Rich text descriptions sanitized server-side (sanitize-html allowlist)
- CSS variables defined in base.css match De Sering brand guidelines
- Request deduplication via `withDedup()` on mutation actions (save, delete)
- Task status cycling updates local state + DOM without full page re-render

## Key Data Flow
- `GET /api/groups` returns groups with nested active projects and `taskCounts` (todo/in_progress/done)
- `GET /api/projects/:id` returns project with full tasks array
- `GET /api/announcements` returns announcements with inline media (batch-fetched)
- `GET /api/comments?targetType=X&targetId=Y` returns comments with attached media
- `GET /api/shopping?projectId=X` returns shopping items (approved only for visitors)
- `GET /api/shopping/summary` returns all projects with shopping totals (budget page)
- `POST /api/shopping` creates item (anyone can suggest, admin auto-approved)
- `GET /api/export` downloads ZIP of all tables as CSVs (admin only)
- `POST /api/media` accepts multipart form upload (photo or voice)
- `GET /api/media/:id/file` serves the uploaded file (checks flat + nested + misc paths)
- Comments: anyone can create (requires authorName); only admin can delete
- Tasks: validated status (todo/in_progress/done), optional assignee + deadline
- Projects: validated status (active/completed/archived), optional tier + joinType
- Shopping: items (name, link, price, qty) and costs (name, amount) per project

## Security
- **Helmet**: CSP, HSTS, X-Frame-Options, nosniff, referrer-policy
- **CSRF**: double-submit cookie on all `/api/*` write operations (X-CSRF-Token header)
- **Rate limiting**: 100 req/min general, 20/min writes, 10/min uploads
- **Input sanitization**: HTML tags stripped from shopping item names/authors server-side; rich text sanitized via sanitize-html
- **URL validation**: only http/https links allowed in shopping items

## Running
```bash
npm run dev           # port 3001 with --watch
npm start             # production
```
Requires `DATABASE_URL` env var pointing to PostgreSQL.
Without `GOOGLE_CLIENT_ID`, runs in dev mode (use /auth/dev-login).

## Don't
- Don't add a build step or bundler
- Don't use import/export in frontend files
- Don't change the Prisma schema without creating a migration
- Don't break the script load order in index.html
- Don't remove asyncHandler wrapping from route handlers
- Don't bypass sanitize() for user-provided HTML content
