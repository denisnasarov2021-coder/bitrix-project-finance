export interface Statement { bind(...values: unknown[]): Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes: number } }> }
export interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<{ meta: { changes: number }; results?: any[] }[]> }
export interface AppEnv { DB: Database; APP_MODE?: string; BITRIX_DOMAIN?: string; BITRIX_ADMIN_IDS?: string; }
export interface User { id: string; tenant: string; name: string; external_id: string | null; global_role: 'admin' | 'member' }
export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export function statement(env: AppEnv, sql: string, ...params: unknown[]) { if (!env.DB) throw new ApiError(503, 'База временно недоступна. Повторите позже.'); return env.DB.prepare(sql).bind(...params); }
export const first = <T = Record<string, unknown>>(env: AppEnv, sql: string, ...params: unknown[]) => statement(env, sql, ...params).first<T>();
export const rows = async <T = Record<string, unknown>>(env: AppEnv, sql: string, ...params: unknown[]) => (await statement(env, sql, ...params).all<T>()).results;
