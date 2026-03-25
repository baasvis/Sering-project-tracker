# CLAUDE.md — Sering Project Tracker

## Stack
- Node.js/Express server, vanilla JS frontend (no build step, no bundler)
- All frontend JS files loaded as `<script>` tags — functions are global
- PostgreSQL database via Prisma ORM
- Google Sign-In for admin auth; visitors enter a name (no login)
- Hosted on Railway (auto-deploy, Postgres plugin)

## Project Structure
```
server.js              — Express app entry point, mounts routers
lib/
  config.js            — Configuration, env vars, admin email list
  db.js                — Prisma client instance
  prisma-client.js     — Re-export from generated prisma
routes/
  auth.js              — Google Sign-In (admin), dev login, requireAdmin middleware
  groups.js            — Group CRUD
  projects.js          — Project CRUD with group relations
  tasks.js             — Task CRUD within projects
  announcements.js     — Announcement CRUD (admin only)
  comments.js          — Comment CRUD (anyone can post, admin can delete)
  media.js             — File upload/serve/delete (photos + voice notes)
  health.js            — Health check endpoint
public/
  index.html           — Shell HTML + name overlay
  css/
    base.css           — Variables, resets, layout, brand styles
    dashboard.css      — Dashboard + announcements
    projects.css       — Project list + detail + tasks
    comments.css       — Comment threads
    media.css          — Media display, voice recorder, lightbox
    admin.css          — Admin panel
    mobile.css         — Responsive overrides
  js/
    state.js           — Constants, NAV_SCREENS, global state object S
    auth.js            — Google Sign-In, dev login, name overlay
    utils.js           — API helpers (apiGet/apiPost/apiPatch/apiDelete), toast, esc, timeAgo
    media.js           — Photo upload, voice recording, lightbox
    comments.js        — Comment rendering + posting
    dashboard.js       — Dashboard screen (announcements + project overview)
    projects.js        — Project list, project detail, task list, modals
    admin.js           — Admin panel (group management)
    init.js            — Navigation, routing, app bootstrap (MUST load last)
prisma/
  schema.prisma        — Database schema (Group, Project, Task, Announcement, Comment, Media)
uploads/               — User-uploaded media files (gitignored)
```

## Script Load Order
Scripts must load in the order listed in index.html:
`state.js` → `auth.js` → `utils.js` → `media.js` → `comments.js` → `dashboard.js` → `projects.js` → `admin.js` → `init.js` (last)

## Conventions
- All frontend functions are global (no modules, no import/export)
- State lives in the global `S` object (defined in state.js)
- Each screen has a render function: `renderDashboard()`, `renderProjects()`, `renderAdmin()`
- `renderCurrentScreen()` dispatches to the active screen
- Hash-based routing: `#dashboard`, `#projects`, `#admin`, `#project/{id}`
- Two auth tiers: admin (Google Sign-In) and visitor (name in localStorage)
- Admin-only actions use `requireAdmin` middleware server-side
- CSS variables defined in base.css match De Sering brand guidelines

## Key Data Flow
- `GET /api/groups` returns groups with nested active projects and task status counts
- `GET /api/projects/:id` returns project with tasks
- `GET /api/announcements` returns announcements (pinned first, newest)
- `GET /api/comments?targetType=X&targetId=Y` returns comments with attached media
- `POST /api/media` accepts multipart form upload (photo or voice)
- `GET /api/media/:id/file` serves the uploaded file
- Comments: anyone can create (requires authorName); only admin can delete
- Tasks: flexible status (todo/in_progress/done), optional assignee + deadline

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
