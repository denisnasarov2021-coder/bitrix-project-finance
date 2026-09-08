import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
export const tenants = sqliteTable('tenants', { id: text('id').primaryKey() });
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull().references(() => tenants.id), name: text('name').notNull(),
  externalId: text('external_id'), globalRole: text('global_role').notNull().default('member'),
}, t => [index('users_tenant').on(t.tenant), check('user_role', sql`${t.globalRole} IN ('admin', 'member')`)]);
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull().references(() => tenants.id), name: text('name').notNull(),
  client: text('client').notNull().default(''), description: text('description').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => users.id), createdAt: text('created_at').notNull(),
}, t => [index('projects_tenant').on(t.tenant)]);
export const members = sqliteTable('members', {
  projectId: text('project_id').notNull().references(() => projects.id), userId: text('user_id').notNull().references(() => users.id), role: text('role').notNull(),
}, t => [primaryKey({ columns: [t.projectId, t.userId] }), check('member_role', sql`${t.role} IN ('manager','editor','viewer')`)]);
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull().references(() => tenants.id), name: text('name').notNull(), normalized: text('normalized').notNull(),
  kind: text('kind').notNull(), expenseClass: text('expense_class').notNull().default('operating'),
}, t => [uniqueIndex('category_name').on(t.tenant, t.kind, t.normalized), check('category_kind', sql`${t.kind} IN ('income','expense')`), check('category_class', sql`${t.expenseClass} IN ('operating','distribution')`)]);
export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull().references(() => tenants.id), projectId: text('project_id').notNull().references(() => projects.id),
  categoryId: text('category_id').notNull().references(() => categories.id), amount: integer('amount').notNull(), date: text('date').notNull(), note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => users.id), updatedBy: text('updated_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), version: integer('version').notNull().default(1), deletedAt: text('deleted_at'),
}, t => [index('entries_project_date').on(t.projectId, t.date), check('entry_amount', sql`typeof(${t.amount}) = 'integer' AND ${t.amount} > 0 AND ${t.amount} <= 999999999999`), check('entry_version', sql`${t.version} > 0`)]);
export const audit = sqliteTable('audit', {
  id: integer('id').primaryKey({ autoIncrement: true }), tenant: text('tenant').notNull(), projectId: text('project_id').notNull(),
  entityId: text('entity_id').notNull(), action: text('action').notNull(), actorId: text('actor_id').notNull(),
  beforeJson: text('before_json'), afterJson: text('after_json'), createdAt: text('created_at').notNull(),
}, t => [index('audit_project').on(t.projectId, t.id)]);
