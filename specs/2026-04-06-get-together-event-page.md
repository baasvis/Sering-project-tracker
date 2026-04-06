# Get Together Event Page

Status: planned
Date: 2026-04-06
Spec-for: builder-reviewer Agent Teams session

## What we're building

A standalone page at route `#get-together` that displays a festival-style two-day schedule grid for the De Sering "Get Together" weekend (April 11–12, 2026). The grid has location rows (admin-defined, e.g. "Kitchen", "Terrace", "Restaurant") and 30-minute visual columns spanning 09:00–21:00 per day. Admins create time blocks that either link to existing projects (pulling in their tasks, shopping items, and tool items) or stand alone with a custom title and description. Visitors can sign up for specific blocks by entering their name. A prep section below the grid aggregates incomplete tasks, unpurchased shopping items, and unavailable tool items from all projects that have time blocks assigned. A static floor map image is displayed for orientation. On mobile, the grid switches to a vertical timeline/card-based layout. This is a one-off feature for this specific event — we'll generalise for future events later.

## Decisions made

1. **One-off, not reusable yet.** The data model is scoped to this event. No generic "Event" entity. We hardcode the two days (April 11, April 12) and the hour range (09:00–21:00). Future events will get a generalised model later.
2. **View on existing data.** Time blocks can link to existing projects. When linked, the block title comes from the project name, and the fold-out shows that project's tasks, shopping items, and tool items. No duplication of data.
3. **30-minute visual grid, 15-minute scheduling precision.** Grid columns represent 30-minute slots. Blocks can start/end on any 15-minute boundary — they render within the same visual column but display their exact time on the block label.
4. **Location rows are admin-defined.** Stored in DB with a display order. Not tied to the existing location concepts in the app.
5. **Unlinked blocks are description-only.** No tasks/shopping/tools. If a meeting needs prep, make it a project.
6. **Sign-ups are per-block, no login required.** Visitor enters their name (same localStorage name as the rest of the app). Multi-select: a person can sign up for multiple blocks. Admins can set a cap per block. Sign-up list shows names, not just a count.
7. **Auto-tagging.** When a project is linked to a time block, if it doesn't already have the tag/filter "At get-together" (this is handled via a convention, not a DB field — see implementation note below), no new schema field is needed. The get-together page itself defines "which projects are part of the event" = "projects that have at least one time block assigned."
8. **Prep section aggregates from linked projects.** Shows: (a) incomplete tasks (status != done), (b) unpurchased shopping items (purchased = false, approved = true), (c) unavailable tool items (available = false, approved = true). Items inherit day from the earliest time block their project is assigned to. If a project has blocks on both days, items show under the first day.
9. **Static floor map.** An uploaded image displayed at the top or side of the page. Admin uploads it via the existing media system. Hardcoded reference to a specific media ID or a dedicated upload slot on the admin panel for this page.
10. **Mobile layout.** Switches from grid to a vertical timeline: day toggle at top, then a chronological list of cards (one per block) showing time, location, title, sign-up count. Tapping a card opens the same fold-out as desktop.

## Data model changes

### New enum

```prisma
enum GetTogetherDay {
  day1  // April 11
  day2  // April 12
}
```

### New models

```prisma
model GetTogetherLocation {
  id        String   @id @default(uuid())
  name      String
  order     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  blocks GetTogetherBlock[]

  @@index([order])
}

model GetTogetherBlock {
  id          String          @id @default(uuid())
  locationId  String
  location    GetTogetherLocation @relation(fields: [locationId], references: [id], onDelete: Restrict)
  day         GetTogetherDay
  startTime   String          // HH:MM format, 15-min increments: "09:00", "09:15", "09:30", "09:45", etc.
  endTime     String          // HH:MM format, 15-min increments
  // Either linked to a project OR has custom title+description
  projectId   String?
  title       String?         // Required if projectId is null
  description String?
  signupCap   Int?            // null = unlimited
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  signups GetTogetherSignup[]

  @@index([day, locationId])
  @@index([projectId])
}

model GetTogetherSignup {
  id        String   @id @default(uuid())
  blockId   String
  block     GetTogetherBlock @relation(fields: [blockId], references: [id], onDelete: Cascade)
  name      String   // Visitor name from localStorage
  createdAt DateTime @default(now())

  @@unique([blockId, name])  // One sign-up per name per block
  @@index([blockId])
}
```

### No changes to existing models

- `Project`, `Task`, `ShoppingItem`, `ToolItem` are untouched.
- The relationship from `GetTogetherBlock.projectId` to `Project.id` is a **logical reference** (not a Prisma relation) to avoid adding a reverse relation to Project. The API validates the projectId exists when creating a block. This keeps the existing models clean for a one-off feature.

**Implementation note on logical reference:** Since `projectId` is not a Prisma `@relation`, the builder must:
- Validate projectId exists in the create/update block endpoint (manual query)
- Join to Project manually when fetching blocks with project data
- NOT rely on Prisma cascading deletes — if a project is deleted, orphan blocks remain (acceptable for a one-off; the admin panel should show a warning)

## Routes / API

### Get Together Locations

```
GET    /api/get-together/locations
       → 200: { locations: GetTogetherLocation[] }

POST   /api/get-together/locations          (admin)
       Body: { name: string, order?: number }
       → 201: { location: GetTogetherLocation }

PATCH  /api/get-together/locations/:id      (admin)
       Body: { name?: string, order?: number }
       → 200: { location: GetTogetherLocation }

DELETE /api/get-together/locations/:id       (admin)
       → 400 if location has blocks assigned
       → 204 on success
```

### Get Together Blocks

```
GET    /api/get-together/blocks
       → 200: {
           blocks: (GetTogetherBlock & {
             location: GetTogetherLocation,
             project?: { id, name, description, contactPerson } | null,
             signups: { id, name }[],
             signupCount: number,
             _tasks?: Task[],            // only included in detail endpoint
             _shoppingItems?: ShoppingItem[],
             _toolItems?: ToolItem[]
           })[]
         }
       Query params: ?day=day1|day2 (optional filter)
       Note: The list endpoint does NOT include tasks/shopping/tools per block.
       Those are fetched on demand when a block is expanded (see detail endpoint).

GET    /api/get-together/blocks/:id
       → 200: {
           block: GetTogetherBlock & {
             location: GetTogetherLocation,
             project?: { id, name, description, contactPerson } | null,
             signups: { id, name }[],
             signupCount: number,
             tasks: Task[],              // from linked project, status != done
             shoppingItems: ShoppingItem[], // from linked project, purchased = false, approved = true
             toolItems: ToolItem[]        // from linked project, available = false, approved = true
           }
         }
       Note: For unlinked blocks, tasks/shoppingItems/toolItems are empty arrays.

POST   /api/get-together/blocks             (admin)
       Body: {
         locationId: string,
         day: "day1" | "day2",
         startTime: string,     // HH:MM, must be 15-min increment
         endTime: string,       // HH:MM, must be 15-min increment, > startTime
         projectId?: string,    // either projectId OR title is required
         title?: string,
         description?: string,
         signupCap?: number     // positive integer or null
       }
       Validation:
         - startTime and endTime must be valid 15-min increments (00, 15, 30, 45)
         - endTime > startTime
         - startTime >= "09:00", endTime <= "21:00"
         - Either projectId or title must be provided (not both empty)
         - If projectId provided, verify project exists and is active
         - Blocks MAY overlap in the same location (admin's responsibility)
       → 201: { block: GetTogetherBlock }

PATCH  /api/get-together/blocks/:id         (admin)
       Body: partial of POST body
       Same validation as POST
       → 200: { block: GetTogetherBlock }

DELETE /api/get-together/blocks/:id          (admin)
       Cascades to signups
       → 204
```

### Get Together Sign-ups

```
POST   /api/get-together/blocks/:id/signup
       Body: { name: string }
       Validation:
         - name: 1-50 chars, HTML stripped
         - If signupCap is set and current signupCount >= signupCap → 409 "Block is full"
         - If name already signed up for this block → 409 "Already signed up"
       → 201: { signup: GetTogetherSignup }

DELETE /api/get-together/blocks/:id/signup
       Body: { name: string }
       Finds and deletes the signup matching blockId + name
       → 204
       → 404 if not found
```

### Get Together Prep Overview

```
GET    /api/get-together/prep
       → 200: {
           day1: {
             tasks: (Task & { projectName: string })[],
             shoppingItems: (ShoppingItem & { projectName: string })[],
             toolItems: (ToolItem & { projectName: string })[]
           },
           day2: {
             tasks: (Task & { projectName: string })[],
             shoppingItems: (ShoppingItem & { projectName: string })[],
             toolItems: (ToolItem & { projectName: string })[]
           }
         }
       Logic:
         1. Find all blocks with a non-null projectId
         2. Group by projectId, determine each project's "day" = day of its earliest block
         3. For each project, fetch:
            - Tasks where status != 'done' and deletedAt is null
            - ShoppingItems where purchased = false and approved = true
            - ToolItems where available = false and approved = true
         4. Merge into day1/day2 buckets, sorted by project name then item name
```

### Get Together Map

```
POST   /api/get-together/map               (admin)
       Multipart form: single image file (same validation as existing media upload)
       Stores to /uploads/get-together/map/{filename}
       Overwrites any existing map image
       → 201: { url: string }

GET    /api/get-together/map
       → 200: { url: string | null }
       Returns the URL of the uploaded map image, or null if none uploaded
```

## SSE (real-time updates)

Use the existing SSE infrastructure (`src/lib/sse.ts`). The get-together page subscribes to the same `/api/sse` stream as other pages.

### New event types to emit

| Event type | Emitted when | Payload | Frontend action |
|------------|-------------|---------|-----------------|
| `get-together:block-created` | Admin creates a block | `{ block: GetTogetherBlock & { location, signups, signupCount } }` | Add block to grid/timeline |
| `get-together:block-updated` | Admin edits a block | `{ block: GetTogetherBlock & { location, signups, signupCount } }` | Update block in place |
| `get-together:block-deleted` | Admin deletes a block | `{ blockId: string }` | Remove block, close fold-out if open |
| `get-together:signup-added` | Someone signs up | `{ blockId: string, signup: { id, name }, signupCount: number }` | Update sign-up list and count on that block |
| `get-together:signup-removed` | Someone leaves | `{ blockId: string, name: string, signupCount: number }` | Remove name from list, update count |
| `get-together:location-created` | Admin adds location | `{ location: GetTogetherLocation }` | Add row to grid |
| `get-together:location-updated` | Admin renames/reorders | `{ location: GetTogetherLocation }` | Update row label/order |
| `get-together:location-deleted` | Admin deletes location | `{ locationId: string }` | Remove row from grid |
| `get-together:tool-toggled` | Someone toggles a tool item | `{ toolItemId: string, available: boolean }` | Update checkbox in prep section |

### Implementation notes

- Emit events from the route handlers after successful DB writes, same pattern as existing routes (e.g. `sse.broadcast('get-together:signup-added', payload)`)
- The frontend `get-together` page registers listeners on mount (`sse.on('get-together:*', handler)`) and removes them on unmount
- Sign-up count in the SSE payload is authoritative — frontend replaces its local count with the server's count to avoid drift
- For the sign-up race condition: if a user clicks "Sign up" but the SSE delivers a `signup-added` that pushes count to cap before the API responds, the frontend should optimistically disable the button. If their own request then returns 409, show a toast: "This block just filled up."

## UI changes

### New page: Get Together (`#get-together`)

**Route:** `#get-together`
**Nav:** Add a link between "Budget" and "Admin" in the navigation bar. Label: "Get Together" with a distinctive style (e.g. yellow highlight badge) since it's a time-limited event.
**Audience:** Everyone (visitors + admins). Admin controls inline.

#### Desktop layout (≥768px)

**Header section:**
- Page title: "Get Together — April 11 & 12"
- Brief intro text (hardcoded): "Two days of building, fixing, planning, and eating together at Sering Centraal."
- Floor map image (full width, max-height ~300px, click to expand/zoom)
- Day toggle: two big buttons "Saturday April 11" / "Sunday April 12" (default: today if it's one of the two days, otherwise Saturday)

**Schedule grid:**
- Y-axis: location rows (ordered by `order` field)
- X-axis: 30-minute columns from 09:00 to 21:00 (24 columns)
- Column headers: "09:00", "09:30", "10:00", ... "20:30"
- Time blocks render as colored bars spanning the appropriate columns:
  - Bar width = (endTime - startTime) / 30min × column width. A 15-minute overhang into a column still claims visually from the block's start position within the column.
  - Linked-to-project blocks: use sering-olive background
  - Custom/unlinked blocks: use sering-red background
  - Social/meal blocks: could be sering-yellow (determined by admin? or just by being unlinked?)
- Each bar shows: **time** (e.g. "10:00–12:30"), **title** (project name or custom title), **sign-up count** (e.g. "3/10" or "5 signed up" if no cap)
- Clicking a bar opens a **fold-out panel** below the grid row (pushes content down, same pattern as project cards on Dashboard):
  - Title, time, location
  - Description (custom blocks) or project description (linked blocks)
  - **Sign-up section:** list of names, "Sign up" / "Leave" button (uses name from localStorage). If at cap, button is disabled with "Full" label. If the visitor hasn't set their name yet, prompt them to enter one.
  - **For linked blocks only:**
    - Tasks list (incomplete only, with status pills: todo / in_progress)
    - Shopping items (unpurchased, approved)
    - Tool items (unavailable, approved)
  - Admin controls: Edit block, Delete block

**Admin controls (visible when signed in as admin):**
- "Add Block" button (opens a form/modal):
  - Day selector (day1 / day2)
  - Location dropdown
  - Start time picker (15-min increments)
  - End time picker (15-min increments)
  - Toggle: "Link to project" / "Custom event"
  - If linked: project search/dropdown (active projects only)
  - If custom: title field, description field
  - Sign-up cap (optional number input)
- "Manage Locations" button (inline or modal):
  - List of locations with drag-to-reorder, rename, delete
  - Add new location
- "Upload Map" button

**Prep section (below the grid):**
- Section title: "What still needs to happen"
- Two sub-sections: "Saturday" / "Sunday" (or just one section if items only fall on one day)
- Each sub-section shows a flat list with three categories visually grouped:
  - **Tasks** — task name, project name tag, status pill (todo / in progress), assignee if set
  - **Shopping** — item name, project name tag, quantity, price
  - **Tools & Items** — item name, project name tag, quantity, available checkbox (anyone can toggle? or admin only?)
    → **Decision: anyone can toggle the "available" checkbox for tool items** (same as how anyone can interact with the rest of the app). This lets volunteers mark "I brought the sandpaper" without needing admin access.
- Each item is tappable/clickable to navigate to its parent project detail page

#### Mobile layout (<768px)

**Same header section** (map is full-width, scrollable/zoomable)

**Day toggle** — same two buttons, sticky at top when scrolling

**Schedule: vertical timeline** (replaces grid)
- Chronological list of cards for the selected day
- Each card:
  - Left edge: colored bar (olive for project, red for custom)
  - **Time** (bold): "10:00 – 12:30"
  - **Location** tag
  - **Title**
  - **Sign-up count**: "3/10 signed up"
  - Tap to expand → same fold-out content as desktop (description, sign-up list, tasks/shopping/tools for linked blocks)
- Cards are sorted by startTime, then by location order for same-time blocks

**Prep section:** same as desktop, renders as a stacked list (already mobile-friendly)

### Components to build

| Component | Description | Used by |
|-----------|-------------|---------|
| `GetTogetherPage` | Top-level page, routes sub-sections | Init/router |
| `ScheduleGrid` | Desktop grid with location rows and time columns | GetTogetherPage (≥768px) |
| `ScheduleTimeline` | Mobile vertical card list | GetTogetherPage (<768px) |
| `TimeBlock` | Single block bar (grid) or card (timeline) | ScheduleGrid, ScheduleTimeline |
| `BlockDetail` | Fold-out with description, sign-ups, tasks/items | TimeBlock (on click) |
| `SignupSection` | Name list + sign-up/leave button | BlockDetail |
| `PrepOverview` | Aggregated tasks/shopping/tools by day | GetTogetherPage |
| `LocationManager` | Admin: CRUD locations | GetTogetherPage (admin) |
| `BlockForm` | Admin: create/edit block form | GetTogetherPage (admin) |
| `MapUpload` | Admin: upload floor map | GetTogetherPage (admin) |

### CSS

New stylesheet: `public/css/get-together.css`
Follow existing patterns. Use brand colours as defined in CSS variables.
- Grid scrolls horizontally if needed on medium screens (between mobile and full desktop)
- Block colours: `--sering-olive` for project blocks, `--sering-red` for custom blocks, `--sering-yellow` for highlighted/social blocks (admin can toggle?)

**Simplification: all unlinked blocks use `--sering-red`, all linked blocks use `--sering-olive`. No third colour category — keep it simple.**

## Edge cases

1. **Block overlaps:** Two blocks at the same time in the same location row. Allowed — admin's responsibility. Grid renders them stacked (second block shifts down within the row, row height expands). Mobile timeline shows them as separate cards in order.
2. **Block spans outside grid range:** Validation prevents startTime < 09:00 or endTime > 21:00. API returns 400.
3. **15-minute alignment visual:** A block from 10:15–11:45 renders starting at the midpoint of the 10:00 column and ending at the midpoint of the 11:30 column. Exact pixel offset = (minutes % 30) / 30 × column width.
4. **Name collision in sign-ups:** Unique constraint on (blockId, name). If "Lisa" is already signed up, a second "Lisa" gets a 409. This is acceptable — names are self-reported and the community is small enough that collisions are rare. If it happens, person can add a last initial.
5. **Project deleted after block created:** Since `projectId` is a logical reference (not a Prisma relation), the block persists but the project data is gone. The block detail endpoint should handle this gracefully: show the block with title "[Deleted project]" and empty task/item lists. The list endpoint should flag these so the admin notices.
6. **Sign-up when block is full:** 409 response. Frontend disables the button and shows "Full" when `signupCount >= signupCap`. Race condition: two people submit simultaneously. The unique constraint + a count check in a transaction prevents over-subscription.
7. **Sign-up without a name:** If localStorage has no visitor name, the sign-up section prompts the visitor to enter one (same UX as the comment name prompt elsewhere in the app). Don't show the sign-up button until a name is set.
8. **Visitor changes their name after signing up:** Old sign-up persists under the old name. This is fine — they can manually leave the old one if they notice. Not worth engineering around for a one-off.
9. **Empty grid:** If no blocks exist for a day, show a friendly message: "No activities scheduled for this day yet." Don't render an empty grid.
10. **Prep section with no items:** If all tasks are done and all items purchased/available, show: "Everything is ready! 🎉" (This is the one emoji we allow.)
11. **Map not uploaded:** Don't show the map section at all. No placeholder.
12. **Long block titles:** Truncate with ellipsis in the grid bar. Full title visible in the fold-out and on mobile cards.
13. **Many sign-ups:** The names list in the fold-out could get long. Show first 10, then "and 5 more..." with expand toggle.

## Out of scope

1. **Reusable event system.** No generic "Event" model. This is hardcoded for April 11–12.
2. **Drag-and-drop block creation/resizing.** Blocks are created via a form. No drag-to-create on the grid.
3. **Interactive map.** The floor map is a static image. No clickable zones.
4. **Notifications / reminders.** No push notifications or emails about upcoming blocks.
5. **Recurring events.** This is a one-off.
6. **Comments on blocks.** Blocks don't have comment threads. If discussion is needed, it happens on the linked project.
7. **Block colour customisation.** Two colours only: olive for project-linked, red for custom.
8. **Export / print view.** No printable schedule PDF.
9. **Attendance tracking / check-in.** Sign-up only, no "I was here" confirmation.
10. **Undo/history for admin actions.** Standard CRUD, no undo.
11. **Admin approval flow for sign-ups.** Sign-ups are instant, no moderation.

## Reviewer checklist

### Data model
- [ ] `GetTogetherLocation`, `GetTogetherBlock`, `GetTogetherSignup` models match spec exactly
- [ ] `GetTogetherDay` enum has exactly two values: `day1`, `day2`
- [ ] `GetTogetherBlock.projectId` is NOT a Prisma `@relation` — it's a plain `String?`
- [ ] `GetTogetherSignup` has `@@unique([blockId, name])` constraint
- [ ] Migration runs cleanly on a fresh database

### API
- [ ] All endpoints require admin auth for write operations (POST/PATCH/DELETE on locations, blocks, map)
- [ ] Sign-up endpoints (POST/DELETE on signup) do NOT require admin auth
- [ ] Time validation: startTime/endTime must be HH:MM with minutes in {00, 15, 30, 45}
- [ ] Time validation: endTime > startTime, both within 09:00–21:00
- [ ] Block creation: either `projectId` or `title` must be provided
- [ ] Block creation: if `projectId` provided, verify project exists and is not deleted
- [ ] Sign-up creation: check cap via count query in same transaction as insert
- [ ] Sign-up creation: name is HTML-stripped, 1-50 chars
- [ ] Prep endpoint correctly groups items by day based on earliest block per project
- [ ] Block detail endpoint handles deleted/missing project gracefully
- [ ] Location delete blocked if blocks exist for that location
- [ ] UUID validation on all `:id` params
- [ ] Rate limiting applied (same rules as existing write endpoints)
- [ ] CSRF protection on all write endpoints

### Frontend
- [ ] Grid renders 24 columns (09:00–20:30) with correct 30-min headers
- [ ] Blocks with 15-minute offsets render at correct sub-column positions
- [ ] Block colours: olive for project-linked, red for custom/unlinked
- [ ] Day toggle defaults to current day if April 11 or 12, otherwise Saturday
- [ ] Mobile breakpoint at 768px switches grid → vertical timeline
- [ ] Block fold-out shows tasks/shopping/tools only for project-linked blocks
- [ ] Sign-up button disabled when block is full (count >= cap)
- [ ] Sign-up button changes to "Leave" when current visitor is already signed up
- [ ] Visitor name prompt appears if localStorage name is not set
- [ ] Prep section shows items grouped by day with correct filtering
- [ ] Floor map displays if uploaded, hidden if not
- [ ] Empty states: no blocks → message, all prep done → celebration message
- [ ] Long titles truncated in grid, full in fold-out
- [ ] Navigation link added between Budget and Admin
- [ ] All admin controls (add block, manage locations, upload map) hidden for non-admins
- [ ] Clicking a task/item in prep section navigates to parent project detail

### Security
- [ ] Input sanitization on block title, description, location name, signup name
- [ ] Block form validates all fields before submission
- [ ] Sign-up race condition handled (transaction or optimistic lock)
- [ ] Map upload uses same file validation as existing media (size limit, MIME type check, no SVG)
- [ ] No XSS vectors in rendered block titles or signup names

### SSE
- [ ] All 9 event types from the spec are emitted by the corresponding route handlers
- [ ] Events are emitted AFTER successful DB write, not before
- [ ] Sign-up count in SSE payload matches actual DB count (queried after write, not incremented client-side)
- [ ] Frontend updates grid/timeline in place without full page refresh on all event types
- [ ] Frontend handles `block-deleted` gracefully when that block's fold-out is currently open (close it)
- [ ] Frontend disables sign-up button reactively when SSE delivers a count that reaches cap
- [ ] SSE listeners are registered on page mount and cleaned up on page unmount (no memory leaks)
