const { z } = require('zod');
const {
  MAX_NAME_LENGTH, MAX_AUTHOR_LENGTH, MAX_CONTACT_LENGTH,
  MAX_TITLE_LENGTH, MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH,
  MAX_PRICE, MAX_QUANTITY,
} = require('./config');

// ─── Shared refinements ─────────────────────────────────────────────────────

const uuid = z.string().uuid();

// Strips HTML tags and trims — used for names, not rich text
const strippedString = (maxLen) =>
  z.string()
    .transform(s => s.replace(/<[^>]*>/g, '').trim())
    .pipe(z.string().min(1).max(maxLen));

const httpUrl = z.string().trim().refine(s => {
  try { return ['http:', 'https:'].includes(new URL(s).protocol); }
  catch { return false; }
}, { message: 'Must be a valid http or https URL' });

// ─── Enums (match Prisma enums exactly) ─────────────────────────────────────

const ProjectStatus = z.enum(['active', 'completed', 'archived']);
const TaskStatus = z.enum(['todo', 'in_progress', 'done']);
const ProjectTier = z.enum(['mvp', 'medium', 'next_level']);
const JoinType = z.enum(['open', 'contact', 'closed']);
const ShoppingItemType = z.enum(['product', 'cost']);
const MediaType = z.enum(['photo', 'voice']);
const CommentTargetType = z.enum(['group', 'project', 'task', 'announcement']);
const MediaParentType = z.enum(['task', 'project', 'announcement', 'comment']);

// ─── Group ──────────────────────────────────────────────────────────────────

const groupCreate = z.object({
  name: strippedString(MAX_NAME_LENGTH),
  description: z.string().optional(),
  mattermostChannel: httpUrl.nullable().optional(),
});

const groupUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  description: z.string().optional(),
  order: z.number().int().min(0).optional(),
  mattermostChannel: httpUrl.nullable().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

// ─── Project ────────────────────────────────────────────────────────────────

const projectCreate = z.object({
  groupId: uuid,
  name: strippedString(MAX_NAME_LENGTH),
  description: z.string().optional(),
  contactPerson: strippedString(MAX_CONTACT_LENGTH).nullable().optional(),
  tier: ProjectTier.nullable().optional(),
  joinType: JoinType.nullable().optional(),
  authorName: strippedString(MAX_AUTHOR_LENGTH).optional(),
});

const projectUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  description: z.string().optional(),
  contactPerson: strippedString(MAX_CONTACT_LENGTH).nullable().optional(),
  status: ProjectStatus.optional(),
  groupId: uuid.optional(),
  tier: ProjectTier.nullable().optional(),
  joinType: JoinType.nullable().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

// ─── Task ───────────────────────────────────────────────────────────────────

const taskCreate = z.object({
  projectId: uuid,
  name: strippedString(MAX_NAME_LENGTH),
  description: z.string().optional(),
  assignee: z.string().max(100).nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  authorName: strippedString(MAX_AUTHOR_LENGTH).optional(),
});

const taskUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  description: z.string().optional(),
  status: TaskStatus.optional(),
  assignee: z.string().max(100).nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  order: z.number().int().min(0).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

// ─── Announcement ───────────────────────────────────────────────────────────

const announcementCreate = z.object({
  title: strippedString(MAX_TITLE_LENGTH),
  body: z.string().min(1),
  pinned: z.boolean().optional().default(false),
});

const announcementUpdate = z.object({
  title: strippedString(MAX_TITLE_LENGTH).optional(),
  body: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

// ─── Comment ────────────────────────────────────────────────────────────────

const commentCreate = z.object({
  targetType: CommentTargetType,
  targetId: uuid,
  authorName: strippedString(MAX_AUTHOR_LENGTH),
  body: z.string().trim().min(MIN_COMMENT_LENGTH).max(MAX_COMMENT_LENGTH),
});

// ─── Shopping Item ──────────────────────────────────────────────────────────

const shoppingItemCreate = z.object({
  projectId: uuid,
  type: ShoppingItemType,
  name: strippedString(MAX_NAME_LENGTH),
  link: httpUrl.nullable().optional(),
  pricePerItem: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional().default(1),
  amount: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  authorName: strippedString(MAX_AUTHOR_LENGTH).optional(),
});

const shoppingItemUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  link: httpUrl.nullable().optional(),
  pricePerItem: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional(),
  amount: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  purchased: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

// ─── Media ──────────────────────────────────────────────────────────────────

const mediaCreate = z.object({
  parentType: MediaParentType,
  parentId: uuid,
});

const mediaBatch = z.object({
  parentType: MediaParentType,
  parentIds: z.string().transform(s => s.split(',')).pipe(z.array(uuid).min(1).max(50)),
});

// ─── Report ─────────────────────────────────────────────────────────────────

const reportCreate = z.object({
  description: strippedString(2000),
  reporterName: strippedString(MAX_AUTHOR_LENGTH),
  screenshotData: z.string().startsWith('data:image/').optional(),
  currentPage: z.string().max(200).optional(),
});

const reportUpdate = z.object({
  resolved: z.boolean().optional(),
  adminNotes: z.string().max(5000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

module.exports = {
  // Enums
  ProjectStatus,
  TaskStatus,
  ProjectTier,
  JoinType,
  ShoppingItemType,
  MediaType,
  CommentTargetType,
  MediaParentType,
  // Entity schemas
  groupCreate,
  groupUpdate,
  projectCreate,
  projectUpdate,
  taskCreate,
  taskUpdate,
  announcementCreate,
  announcementUpdate,
  commentCreate,
  shoppingItemCreate,
  shoppingItemUpdate,
  mediaCreate,
  mediaBatch,
  reportCreate,
  reportUpdate,
  // Shared
  uuid,
};
