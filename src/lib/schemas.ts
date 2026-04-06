import { z } from 'zod';
import {
  MAX_NAME_LENGTH, MAX_AUTHOR_LENGTH, MAX_CONTACT_LENGTH,
  MAX_TITLE_LENGTH, MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH,
  MAX_PRICE, MAX_QUANTITY,
} from './config.js';

// ─── Shared refinements ─────────────────────────────────────────────────────

export const uuid = z.string().uuid();

// Strips HTML tags and trims — used for names, not rich text
const strippedString = (maxLen: number) =>
  z.string()
    .transform(s => s.replace(/<[^>]*>/g, '').trim())
    .pipe(z.string().min(1).max(maxLen));

const httpUrl = z.string().trim().refine(s => {
  try { return ['http:', 'https:'].includes(new URL(s).protocol); }
  catch { return false; }
}, { message: 'Must be a valid http or https URL' });

// ─── Enums (match Prisma enums exactly) ─────────────────────────────────────

export const ProjectStatus = z.enum(['active', 'completed', 'archived']);
export const TaskStatus = z.enum(['todo', 'in_progress', 'done']);
export const ProjectTier = z.enum(['mvp', 'medium', 'next_level']);
export const JoinType = z.enum(['open', 'contact', 'closed']);
export const ShoppingItemType = z.enum(['product', 'cost']);
export const MediaType = z.enum(['photo', 'voice']);
export const CommentTargetType = z.enum(['group', 'project', 'task', 'announcement']);
export const MediaParentType = z.enum(['task', 'project', 'announcement', 'comment']);

// ─── Inferred types ─────────────────────────────────────────────────────────

export type ProjectStatusType = z.infer<typeof ProjectStatus>;
export type TaskStatusType = z.infer<typeof TaskStatus>;
export type ProjectTierType = z.infer<typeof ProjectTier>;
export type JoinTypeType = z.infer<typeof JoinType>;
export type ShoppingItemTypeType = z.infer<typeof ShoppingItemType>;
export type MediaTypeType = z.infer<typeof MediaType>;
export type CommentTargetTypeType = z.infer<typeof CommentTargetType>;
export type MediaParentTypeType = z.infer<typeof MediaParentType>;

// ─── Group ──────────────────────────────────────────────────────────────────

export const groupCreate = z.object({
  name: strippedString(MAX_NAME_LENGTH),
  description: z.string().optional(),
  mattermostChannel: httpUrl.nullable().optional(),
});

export const groupUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  description: z.string().optional(),
  order: z.number().int().min(0).optional(),
  mattermostChannel: httpUrl.nullable().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type GroupCreate = z.infer<typeof groupCreate>;
export type GroupUpdate = z.input<typeof groupUpdate>;

// ─── Project ────────────────────────────────────────────────────────────────

export const projectCreate = z.object({
  groupId: uuid,
  name: strippedString(MAX_NAME_LENGTH),
  description: z.string().optional(),
  contactPerson: strippedString(MAX_CONTACT_LENGTH).nullable().optional(),
  tier: ProjectTier.nullable().optional(),
  joinType: JoinType.nullable().optional(),
  authorName: strippedString(MAX_AUTHOR_LENGTH).optional(),
});

export const projectUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  description: z.string().optional(),
  contactPerson: strippedString(MAX_CONTACT_LENGTH).nullable().optional(),
  status: ProjectStatus.optional(),
  groupId: uuid.optional(),
  tier: ProjectTier.nullable().optional(),
  joinType: JoinType.nullable().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type ProjectCreate = z.infer<typeof projectCreate>;
export type ProjectUpdate = z.input<typeof projectUpdate>;

// ─── Task ───────────────────────────────────────────────────────────────────

export const taskCreate = z.object({
  projectId: uuid,
  name: strippedString(MAX_NAME_LENGTH),
  description: z.string().optional(),
  assignee: z.string().max(100).nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  authorName: strippedString(MAX_AUTHOR_LENGTH).optional(),
});

export const taskUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  description: z.string().optional(),
  status: TaskStatus.optional(),
  assignee: z.string().max(100).nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  order: z.number().int().min(0).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type TaskCreate = z.infer<typeof taskCreate>;
export type TaskUpdate = z.input<typeof taskUpdate>;

// ─── Announcement ───────────────────────────────────────────────────────────

export const announcementCreate = z.object({
  title: strippedString(MAX_TITLE_LENGTH),
  body: z.string().min(1),
  pinned: z.boolean().optional().default(false),
});

export const announcementUpdate = z.object({
  title: strippedString(MAX_TITLE_LENGTH).optional(),
  body: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type AnnouncementCreate = z.infer<typeof announcementCreate>;
export type AnnouncementUpdate = z.input<typeof announcementUpdate>;

// ─── Comment ────────────────────────────────────────────────────────────────

export const commentCreate = z.object({
  targetType: CommentTargetType,
  targetId: uuid,
  authorName: strippedString(MAX_AUTHOR_LENGTH),
  body: z.string().trim().min(MIN_COMMENT_LENGTH).max(MAX_COMMENT_LENGTH),
});

export type CommentCreate = z.infer<typeof commentCreate>;

// ─── Shopping Item ──────────────────────────────────────────────────────────

const metadataFields = {
  notes: z.string().max(500).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  importance: z.string().max(50).nullable().optional(),
  assignedTo: z.string().max(100).nullable().optional(),
};

export const shoppingItemCreate = z.object({
  projectId: uuid,
  type: ShoppingItemType,
  name: strippedString(MAX_NAME_LENGTH),
  link: httpUrl.nullable().optional(),
  pricePerItem: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional().default(1),
  amount: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  authorName: strippedString(MAX_AUTHOR_LENGTH).optional(),
  ...metadataFields,
});

export const shoppingItemUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  link: httpUrl.nullable().optional(),
  pricePerItem: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional(),
  amount: z.number().min(0).max(MAX_PRICE).nullable().optional(),
  purchased: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  ...metadataFields,
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type ShoppingItemCreate = z.infer<typeof shoppingItemCreate>;
export type ShoppingItemUpdate = z.input<typeof shoppingItemUpdate>;

// ─── Tool Item ─────────────────────────────────────────────────────────────

export const toolItemCreate = z.object({
  projectId: uuid,
  name: strippedString(MAX_NAME_LENGTH),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional().default(1),
  link: httpUrl.nullable().optional(),
  authorName: strippedString(MAX_AUTHOR_LENGTH).optional(),
  ...metadataFields,
});

export const toolItemUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional(),
  available: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  link: httpUrl.nullable().optional(),
  ...metadataFields,
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type ToolItemCreate = z.infer<typeof toolItemCreate>;
export type ToolItemUpdate = z.input<typeof toolItemUpdate>;

// ─── Media ──────────────────────────────────────────────────────────────────

export const mediaCreate = z.object({
  parentType: MediaParentType,
  parentId: uuid,
});

export const mediaBatch = z.object({
  parentType: MediaParentType,
  parentIds: z.string().transform(s => s.split(',')).pipe(z.array(uuid).min(1).max(50)),
});

export type MediaCreate = z.infer<typeof mediaCreate>;

// ─── Report ─────────────────────────────────────────────────────────────────

export const reportCreate = z.object({
  description: strippedString(2000),
  reporterName: strippedString(MAX_AUTHOR_LENGTH),
  screenshotData: z.string().startsWith('data:image/').optional(),
  currentPage: z.string().max(200).optional(),
});

export const reportUpdate = z.object({
  resolved: z.boolean().optional(),
  adminNotes: z.string().max(5000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type ReportCreate = z.infer<typeof reportCreate>;
export type ReportUpdate = z.input<typeof reportUpdate>;

// ─── Get Together ──────────────────────────────────────────────────────────

export const GetTogetherDay = z.enum(['day1', 'day2']);
export type GetTogetherDayType = z.infer<typeof GetTogetherDay>;

// HH:MM with 15-minute increments, within 09:00–21:00
const timeSlot = z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').refine(s => {
  const [h, m] = s.split(':').map(Number);
  return h !== undefined && m !== undefined &&
    h >= 9 && h <= 21 && [0, 15, 30, 45].includes(m) &&
    (h < 21 || m === 0); // 21:00 is valid but 21:15 is not
}, { message: 'Must be a 15-minute increment between 09:00 and 21:00' });

export const getTogetherLocationCreate = z.object({
  name: strippedString(MAX_NAME_LENGTH),
  order: z.number().int().min(0).optional(),
});

export const getTogetherLocationUpdate = z.object({
  name: strippedString(MAX_NAME_LENGTH).optional(),
  order: z.number().int().min(0).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type GetTogetherLocationCreate = z.infer<typeof getTogetherLocationCreate>;
export type GetTogetherLocationUpdate = z.input<typeof getTogetherLocationUpdate>;

export const getTogetherBlockCreate = z.object({
  locationId: uuid,
  day: GetTogetherDay,
  startTime: timeSlot,
  endTime: timeSlot,
  projectId: uuid.nullable().optional(),
  title: strippedString(MAX_NAME_LENGTH).nullable().optional(),
  description: z.string().nullable().optional(),
  signupCap: z.number().int().min(1).nullable().optional(),
}).refine(data => {
  // endTime must be after startTime
  return data.endTime > data.startTime;
}, { message: 'endTime must be after startTime' }).refine(data => {
  // Either projectId or title must be provided
  return data.projectId || data.title;
}, { message: 'Either projectId or title must be provided' });

export const getTogetherBlockUpdate = z.object({
  locationId: uuid.optional(),
  day: GetTogetherDay.optional(),
  startTime: timeSlot.optional(),
  endTime: timeSlot.optional(),
  projectId: uuid.nullable().optional(),
  title: strippedString(MAX_NAME_LENGTH).nullable().optional(),
  description: z.string().nullable().optional(),
  signupCap: z.number().int().min(1).nullable().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });

export type GetTogetherBlockCreate = z.infer<typeof getTogetherBlockCreate>;
export type GetTogetherBlockUpdate = z.input<typeof getTogetherBlockUpdate>;

export const getTogetherSignupCreate = z.object({
  name: strippedString(MAX_AUTHOR_LENGTH),
});
