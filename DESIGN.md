# Sering Project Tracker — Design Document

*Last updated: 2026-03-29*
*Master reference for any AI assistant working on this codebase.*

---

## 1. What Is This?

A standalone web app for **De Sering** — a community-driven vegan food organisation in Amsterdam — to track projects and tasks across its locations and initiatives.

Think of it as a transparent, media-rich project board where:
- **Admins** (3 people) create and manage groups, projects, tasks, and announcements
- **Everyone else** (50+ staff and hundreds of volunteers) can view everything and comment with text, photos, and voice notes — no login required

### Why Build This?

De Sering runs multiple locations (Sering West, Sering Centraal, TestTafel), does catering, hosts events, and is expanding. Big initiatives — renovations, new location launches, events, organisational changes — need tracking that the whole community can follow and contribute to. Current tools (Notion at ~€100-150/month) don't fit the culture: too many barriers, too corporate, not enough transparency.

---

## 2. Organisation Context

See the [Food Planner DESIGN.md](https://github.com/baasvis/Sering-food-planner/blob/main/DESIGN.md) for full organisation details. Key points:

- **Sering West** (HQ): Community kitchen + cafe at Rhoneweg 6, ~57 staff + volunteers on peak days
- **TestTafel**: Experimental fine dining at Mediamatic
- **Sering Centraal**: Newest location, same building as TestTafel, growing fast
- **Culture**: Egalitarian, decentralised, most staff in their first real job, hundreds of dedicated volunteers
- **Values**: Transparency, community, accessibility, activism, DIY spirit

---

## 3. Core Concepts

### Hierarchy

```
Groups/Themes     e.g. "Construction", "Operations", "Events", "Expansion"
  └─ Projects     e.g. "Build terrace at Centraal", "Launch Tuesday dinners"
       └─ Tasks   e.g. "Order wood", "Find 3 extra volunteers", "Get building permit"
```

- **Groups** are broad categories/themes. A group can have many projects.
- **Projects** are concrete initiatives with a clear goal. A project belongs to one group.
- **Tasks** are individual action items within a project. Flexible: optionally assigned to someone, optionally with a deadline.

### Dashboard

The landing page everyone sees. Contains:
- **Announcements** posted by admins — updates, highlights, news (with optional media: photos, voice notes)
- **Project overview** — quick view of active projects and their progress
- Navigation into groups/projects/tasks

### Comments

Anyone can comment on any group, project, or task. Comments support:
- Text
- Photos (upload from phone/computer)
- Voice notes (record in browser)

### Media

Photos, voice notes, and text are supported everywhere:
- On tasks (e.g. photo of completed work, voice note explaining a blocker)
- On projects (e.g. progress photos, audio update)
- On announcements (e.g. photo of the new terrace, voice message from the director)
- On comments (e.g. volunteer posts a photo of materials they found)

### Task Statuses

Simple three-state flow:
- **To do** — not started
- **In progress** — someone is working on it
- **Done** — completed

Tasks have optional fields:
- **Assignee** — who's responsible (free text name, not tied to accounts)
- **Deadline** — when it should be done
- **Description** — details, instructions, context
- **Media** — photos, voice notes

---

## 4. Auth Model

Two tiers:

### Admins (3 people)
- Sign in with **Google Sign-In** (allowed email list, hardcoded or env var)
- Can: create/edit/delete groups, projects, tasks, announcements
- Can: moderate comments (delete inappropriate ones)
- See an "Admin" indicator in the UI

### Everyone Else
- **No login required** — just enter a name when first visiting
- Name stored in localStorage, shown on their comments
- Can: view everything, comment on everything (with media)
- Can: suggest tasks, projects, and shopping items (pending admin approval — visible to all as greyed-out pending)
- Cannot: create/edit/delete groups, announcements, or directly approved items

---

## 5. Brand & Visual Design

Based on the De Sering Brand Guidelines (February 2026).

### Colours

| Name | Hex | Usage |
|------|-----|-------|
| **De Sering Red** | `#FF3F00` | Primary accent, buttons, highlights, active states |
| **Off-White** | `#F3F1EC` | Page background, cards |
| **Olive Green** | `#494C1A` | Secondary accent, tags, status indicators |
| **Yellow** | `#ECEB01` | Highlights, badges, attention elements |
| **Black** | `#000000` | Text, contrast elements |
| **Burgundy** | `#8F0500` | Reserved for Sering Centraal-specific elements |

### Typography

**Primary typeface**: Overused Grotesk (variable font, matching desering.org)

| Weight | Usage | Size ratio |
|--------|-------|-----------|
| Bold | Page titles, section headers | 2.9x body |
| Bold | Subtitles, card headers | 1.4x body |
| Medium | Highlighted text, labels, buttons | — |
| Light | Body text, descriptions, comments | Base size |

**Fallback stack**: `'Overused Grotesk', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif`

Self-hosted as a variable font file (`/fonts/OverusedGroteskRoman-VF.woff2`), preloaded in index.html.

### Visual Style

- **Warm and approachable** — not corporate, not minimal-tech
- **Expressive** — hand-drawn elements, sticker/stamp-style graphics are welcome
- **DIY energy** — reflects activism and community culture
- **Colourful** — uses the full palette, not just black and white
- **Photography style**: People, togetherness, hard flash, colourful, authentic food shots
- **Cards and blocks** — content organised in clear visual blocks with generous spacing

### CSS Variables (starting point)

```css
:root {
  /* Brand colours */
  --sering-red: #FF3F00;
  --sering-off-white: #F3F1EC;
  --sering-olive: #494C1A;
  --sering-yellow: #ECEB01;
  --sering-black: #000000;
  --sering-burgundy: #8F0500;

  /* Functional colours */
  --bg-primary: var(--sering-off-white);
  --bg-card: #FFFFFF;
  --text-primary: var(--sering-black);
  --text-secondary: #555555;
  --accent: var(--sering-red);
  --accent-hover: #E63800;
  --success: var(--sering-olive);
  --highlight: var(--sering-yellow);

  /* Typography */
  --font-family: 'Overused Grotesk', 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --font-size-base: 16px;
  --font-size-title: calc(var(--font-size-base) * 2.9);
  --font-size-subtitle: calc(var(--font-size-base) * 1.4);

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 40px;

  /* Borders */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 20px;
}
```

---

## 6. Screens & Navigation

### Navigation Structure

Simple top bar (desktop) / bottom bar (mobile):
- **Dashboard** (home) — announcements + project overview
- **Projects** — browse by group, see all projects
- **Admin** (only visible when signed in as admin)

### Screen: Dashboard

The landing page. Two sections:

**Announcements** (top)
- Reverse-chronological list of admin-posted announcements
- Each announcement: title, preview text (first ~150 characters of body), optional media (photos/voice), timestamp, author
- Click to expand and read full body; click again to collapse
- "Post announcement" button (admin only)

**Tier filter buttons** (between announcements and projects)
- Three big buttons: MVP, Medium, Next Level — each with a label and description
- Clicking a button filters the projects below to that tier only; clicking again deselects
- Filter state persists when navigating between Dashboard and Projects screens

**Active Projects** (below)
- Cards showing active projects grouped by theme/group, sorted by tier within each group (MVP first, then Medium, then Next Level, then untiered)
- Each card: project name, tier/join-type/group tags, progress indicator (X of Y tasks done)
- Click a card to fold open inline — shows project description and task list with status indicators
- Expanded card spans full width of the grid; click again to collapse
- "View full details" button inside expanded card navigates to the full project detail page

### Screen: Projects

Browse and explore:
- **Tier filter buttons** — MVP / Medium / Next Level (same as dashboard, above group tabs)
- **Group filter** — tabs to filter by group/theme (combines with tier filter)
- **Project list** — cards for each project matching the active filters, sorted by tier (MVP → Medium → Next Level → untiered)
- Cards fold open inline on click (same behaviour as dashboard); "View full details" button navigates to full project detail
- **Search** — find projects or tasks by keyword

### Screen: Project Detail

Single project view:
- **Header**: Project name, group tag, description, media, progress bar
- **Task list**: All tasks with status, optional assignee, optional deadline. Pending tasks shown greyed out with dashed border for all users; admins see Approve / Decline buttons
- **Shopping list**: Products (name, link, price, quantity) and extra costs (description, amount) with totals. Pending suggestions visible to all, greyed out; admins see Approve / Reject
- **Comments section**: Thread of comments (text + media) from anyone
- Admin controls: edit project, add/edit/delete tasks, approve/decline suggestions, manage shopping items
- Visitors can suggest tasks and shopping items (pending admin approval — shown immediately as greyed-out pending)

### Screen: Task Detail

Single task view (could be a modal or full page):
- **Header**: Task name, status pill, assignee, deadline
- **Description**: Text + media
- **Comments**: Thread of comments from anyone
- Admin controls: edit task, change status

### Screen: Budget

Visible to everyone (between Projects and Admin in nav):
- **Header**: "Budget" with grand total across all active projects
- **Project rows**: Each shows project name, group tag, approved total cost, approved item count
- **Fold-out**: Click a project row to expand and see its shopping items inline
  - Same item list as project detail (approved products + costs)
  - Pending suggestions also appear in the fold-out for all users (with "Pending approval" badge for visitors; Approve/Reject buttons for admins)
  - Admins can approve/reject pending suggestions, and add/edit/delete items directly from this view
  - Fold-out stays open after an action (e.g. approving an item) to show the updated state
  - Click again to collapse
- Only projects with at least one approved shopping item are shown

### Screen: Admin Panel

Only accessible to signed-in admins:
- **Manage groups**: Create, rename, reorder, delete groups
- **Quick actions**: Links to create new project, post announcement
- **Reports**: View unresolved problem reports with screenshots, resolve or delete them
- **Data export**: Download all data as a ZIP of CSVs (groups, projects, tasks, announcements, comments, shopping items, media)
- **Admin list**: Which Google accounts have admin access

---

## 7. Data Model

### Group
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| name | String | e.g. "Construction" |
| description | String? | Optional |
| order | Int | Display order |
| createdAt | DateTime | |

### Project
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| groupId | UUID | FK → Group |
| name | String | e.g. "Build terrace" |
| description | String? | Rich text or plain |
| contactPerson | String? | Who to contact about this project |
| status | Enum | active / completed / archived |
| approved | Boolean | true for admin-created; false = pending approval |
| suggestedBy | String? | Visitor name if suggestion |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### Task
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| projectId | UUID | FK → Project |
| name | String | e.g. "Order wood" |
| description | String? | |
| status | Enum | todo / in_progress / done |
| assignee | String? | Free text name |
| deadline | Date? | Optional |
| order | Int | Display order within project |
| approved | Boolean | true for admin-created; false = pending approval |
| suggestedBy | String? | Visitor name if suggestion |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### Announcement
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| title | String | |
| body | String | |
| authorEmail | String | Admin who posted |
| pinned | Boolean | Sticky to top of dashboard |
| createdAt | DateTime | |

### Comment
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| targetType | Enum | group / project / task / announcement |
| targetId | UUID | FK to the target entity |
| authorName | String | Free text (from localStorage or admin email) |
| body | String? | Text content |
| createdAt | DateTime | |

### ShoppingItem
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| projectId | UUID | FK → Project (cascade delete) |
| type | String | product / cost |
| name | String | Item name or cost description |
| link | String? | URL for products (http/https only) |
| pricePerItem | Float? | Price per unit (products) |
| quantity | Int? | Number of items (products, default 1) |
| amount | Float? | Fixed amount (costs, e.g. labour) |
| purchased | Boolean | Whether item has been obtained |
| suggestedBy | String? | Visitor name if suggestion |
| approved | Boolean | Admin must approve visitor suggestions |
| order | Int | Display order within project |
| createdAt | DateTime | |
| updatedAt | DateTime | |

### Media
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| parentType | Enum | task / project / announcement / comment |
| parentId | UUID | FK to parent entity |
| type | Enum | photo / voice |
| filename | String | Stored filename |
| originalName | String | Original upload name |
| mimeType | String | e.g. image/jpeg, audio/webm |
| sizeBytes | Int | File size |
| createdAt | DateTime | |

### Report
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| description | String | Problem description (max 2000 chars, HTML stripped) |
| screenshotData | String? | Base64 data URL of auto-captured screenshot |
| reporterName | String | Visitor name or admin email |
| currentPage | String? | Hash route when report was created |
| resolved | Boolean | Default false; admin marks resolved |
| adminNotes | String? | Admin response/notes |
| createdAt | DateTime | |
| updatedAt | DateTime | |

Media files stored on disk (Railway volume) at `/uploads/{parentType}/{parentId}/{filename}`.

---

## 8. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Vanilla JS | No build step. Consistent with food planner. Simple enough for this app. |
| Backend | Node.js + Express | Same as food planner. Known, stable, Claude-friendly. |
| Database | PostgreSQL + Prisma | Relational data (groups → projects → tasks), media metadata, comments. |
| File storage | Local disk (Railway volume) | Start simple. Move to S3/R2 if storage grows beyond Railway limits. |
| Auth | Google Sign-In (admin only) | Only 3 admins need real auth. Everyone else just enters a name. |
| Hosting | Railway | Same platform as food planner. Auto-deploy, Postgres plugin, persistent volumes. |
| Voice recording | MediaRecorder API | Built into modern browsers. Records WebM/Opus audio. |

### Why Vanilla JS Again?

This app has ~6 screens with relatively simple interactions. The most complex parts are media upload and voice recording, which are browser APIs — no framework needed. Vanilla JS keeps the stack identical to the food planner, meaning Daan (and Claude) can move between projects without context-switching.

---

## 9. API Endpoints

### Auth
- `GET /auth/google` — Google Sign-In callback
- `POST /auth/logout` — Clear session
- `GET /auth/me` — Current user (admin or null)

### Groups
- `GET /api/groups` — List all groups (with project counts)
- `POST /api/groups` — Create group (admin)
- `PATCH /api/groups/:id` — Update group (admin)
- `DELETE /api/groups/:id` — Delete group (admin, only if no projects)

### Projects
- `GET /api/projects` — List projects (optional `?groupId=`, `?status=` filter) — includes pending
- `GET /api/projects/:id` — Single project with all tasks (including pending)
- `POST /api/projects` — Create project (admin, auto-approved) or suggest project (visitor, pending approval)
- `PATCH /api/projects/:id` — Update project (admin)
- `PATCH /api/projects/:id/approve` — Approve a suggested project (admin)
- `DELETE /api/projects/:id` — Delete / decline project (admin)

### Tasks
- `GET /api/projects/:projectId/tasks` — List tasks for project
- `POST /api/tasks` — Create task (admin, auto-approved) or suggest task (visitor, pending approval)
- `PATCH /api/tasks/:id` — Update task (admin)
- `PATCH /api/tasks/:id/approve` — Approve a suggested task (admin)
- `DELETE /api/tasks/:id` — Delete / decline task (admin)

### Announcements
- `GET /api/announcements` — List announcements (newest first)
- `POST /api/announcements` — Create announcement (admin)
- `PATCH /api/announcements/:id` — Update announcement (admin)
- `DELETE /api/announcements/:id` — Delete announcement (admin)

### Shopping
- `GET /api/shopping?projectId=xxx` — List items for a project (approved only for visitors, all for admins)
- `GET /api/shopping/summary` — All projects with totals and items (for budget page)
- `POST /api/shopping` — Create item (anyone can suggest, admin auto-approved)
- `PATCH /api/shopping/:id` — Update item (admin)
- `PATCH /api/shopping/:id/approve` — Approve suggestion (admin)
- `DELETE /api/shopping/:id` — Delete item (admin)

### Comments
- `GET /api/comments?targetType=project&targetId=xxx` — List comments for a target
- `POST /api/comments` — Create comment (anyone, requires `authorName`)
- `DELETE /api/comments/:id` — Delete comment (admin only)

### Reports
- `POST /api/reports` — Submit a problem report (anyone; auto-captured screenshot as base64)
- `GET /api/reports` — List reports (admin only, `?resolved=true/false` filter)
- `GET /api/reports/:id` — Single report with screenshot (admin only)
- `PATCH /api/reports/:id` — Resolve or add notes (admin only)
- `DELETE /api/reports/:id` — Delete report (admin only)

### Export
- `GET /api/export` — Download all tables as a ZIP of CSVs (admin only)

### Media
- `POST /api/media` — Upload file (multipart form, with parentType + parentId)
- `GET /api/media/:id` — Serve file
- `DELETE /api/media/:id` — Delete file (admin)
- `GET /uploads/:parentType/:parentId/:filename` — Static file serving

---

## 10. File Structure (planned)

```
server.js                — Express entry point
lib/
  config.js              — Env vars, admin email list
  db.js                  — Prisma client
prisma/
  schema.prisma          — Database schema
routes/
  auth.js                — Google Sign-In, session, requireAdmin middleware
  groups.js              — Group CRUD
  projects.js            — Project CRUD
  tasks.js               — Task CRUD
  announcements.js       — Announcement CRUD
  comments.js            — Comment CRUD
  media.js               — File upload/serve/delete
  reports.js             — Problem reports (submit + admin manage)
  health.js              — Health check
public/
  index.html             — HTML shell
  css/
    base.css             — Variables, resets, layout, brand styles
    dashboard.css        — Dashboard + announcements
    projects.css         — Project list + detail
    tasks.css            — Task list + detail
    comments.css         — Comment threads
    media.css            — Media display, voice recorder
    admin.css            — Admin panel
    mobile.css           — Responsive overrides
  js/
    state.js             — App state, constants, reactive S object
    events.js            — Custom event bus (EventTarget-based pub/sub)
    auth.js              — Google Sign-In (admin), name entry (visitors)
    utils.js             — API helpers, toast, html`` tagged template, helpers
    dashboard.js         — Dashboard screen
    projects.js          — Project list + detail screens
    comments.js          — Comment threads, media-in-comments
    media.js             — Photo upload, voice recorder, lightbox
    shopping.js          — Shopping list UI per project
    budget.js            — Budget overview screen
    reports.js           — Floating report button, screenshot capture modal
    admin.js             — Admin panel (incl. report management)
    sse.js               — SSE event handlers (real-time updates)
    init.js              — Router, navigation, app init (LAST)
  fonts/                 — Self-hosted Overused Grotesk variable font
uploads/                 — User-uploaded media (gitignored)
data/                    — Any server-side JSON config (gitignored)
DESIGN.md                — This document
CLAUDE.md                — Claude Code instructions
```

---

## 11. Development Approach

Same philosophy as the food planner:
- **Small, tested increments** — build one feature, verify, push
- **DESIGN.md is the reference** — read it before making changes, update it after
- **Git is the safety net** — clear commit messages, easy to revert
- **Verify with preview** — always check the UI after changes

### Build Order (thin slices)

1. **Scaffold** — Express server, Prisma schema, basic HTML shell, auth (admin Google + visitor name)
2. **Groups + Projects** — CRUD, list view, detail view
3. **Tasks** — CRUD within projects, status flow
4. **Dashboard** — Announcements + project overview
5. **Comments** — Comment threads on all entities
6. **Media** — Photo upload everywhere, display in cards/comments
7. **Voice notes** — Browser recording, upload, playback
8. **Polish** — Mobile responsive, brand styling, transitions

---

## 12. Design Principles

Inherited from De Sering's culture:

1. **Zero friction for the community** — no login wall, no sign-up, just enter your name and participate
2. **Full transparency** — everyone sees everything, no hidden projects or restricted areas
3. **Admin guardrails** — only verified admins can change structure, preventing chaos while keeping openness
4. **Media-first** — a photo of progress or a quick voice note is often more valuable than typed text
5. **Mobile-first** — most people will use this on their phone in the kitchen, on the terrace, or on the go
6. **Brand-consistent** — looks and feels like De Sering, not like a generic project management tool
7. **Simple over clever** — three task statuses, not twelve. Plain comments, not threaded discussions with reactions and mentions.

---

## 13. Security & Abuse Prevention

Implemented protections for a public-facing app:

- **Security headers** (helmet): CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, hides X-Powered-By
- **CSRF protection**: double-submit cookie pattern on all `/api/*` write operations; frontend sends `X-CSRF-Token` header
- **Rate limiting** (express-rate-limit): 100 req/min general API, 20/min for write operations, 10/min for file uploads — all per IP
- **Input sanitization**: HTML tags stripped server-side from shopping item names, author names, and comment bodies; URL protocol validation (http/https only)
- **Media upload validation**: parent entity must exist before upload is accepted (prevents orphaned files)
- **UUID validation**: all route params and query params validated as UUID format before Prisma queries
- **Comment spam protection**: min 2 / max 2000 chars, duplicate detection within 5-minute window, name validation (1-50 chars)
- **Media upload restrictions**: requires identity (admin session or visitor name), photos max 5MB, voice notes max 2MB (~60 seconds), auto-stop recording at 60s, client-side size check before upload
- **Global storage cap**: 100MB total uploads — prevents abuse as free storage. Returns 507 when full.
- **Admin-only moderation**: only admins can delete comments and media
- **Soft-delete protection**: PATCH endpoints reject updates to soft-deleted records
- **SSE resilience**: exponential backoff reconnection (never gives up), visual disconnection indicator
- **Accessibility**: `:focus-visible` on all interactive elements, `prefers-reduced-motion`, WCAG AA contrast, `<noscript>` fallback
- **Database enums**: `Project.status`, `Task.status`, `ShoppingItem.type` enforced as PostgreSQL enums (not text)
- **Decimal money fields**: `ShoppingItem.pricePerItem` and `amount` use `Decimal(10,2)` to avoid floating-point errors
- **Report validation**: screenshot must be `data:image/*` data URL (max 2MB), description/name HTML-stripped, UUID validation on all `:id` params

---

## 14. Open Questions

Things to decide as we build:

- [x] **Font**: Using Overused Grotesk (variable font, self-hosted), matching desering.org.
- [x] **Voice note length limit**: 60 seconds, 2MB max
- [x] **Photo size limit**: 5MB max per file
- [x] **Comment moderation**: Admin-delete only (no community flag button for now)
- [x] **Real-time updates**: SSE (Server-Sent Events) implemented — all clients see changes instantly without refreshing. Email notifications still open.
- [ ] **Email notifications**: Should admins get email notifications for new comments/suggestions?
- [ ] **Domain**: What URL will this live at? projects.desering.org? sering-projects.up.railway.app?
- [ ] **Railway volume persistence**: Confirm Railway volume survives redeploys for uploaded media
- [ ] **Storage cap**: 100MB is conservative — increase once Railway volume size is confirmed
