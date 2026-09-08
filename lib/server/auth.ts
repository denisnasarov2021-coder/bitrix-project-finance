import { ApiError, first, statement } from './types.ts';
import type { AppEnv, User } from './types.ts';
import { categoryStatements, seedDemo } from './seed.ts';
export function mode(env: AppEnv) { if (env.APP_MODE === 'demo' && env.BITRIX_DOMAIN) throw new ApiError(503, 'Отключите демонстрационный режим перед подключением портала.'); return env.APP_MODE === 'demo' ? 'demo' : 'bitrix'; }
export function portalDomain(env: AppEnv) {
  const domain = env.BITRIX_DOMAIN?.trim().toLowerCase();
  // Fixed server-side allowlist: client-supplied domain/endpoint is never used for fetch.
  if (!domain || !/^[a-z0-9][a-z0-9-]*\.(bitrix24\.(ru|com|de|eu|es|fr|it|pl|com\.br)|bitrix24site\.ru)$/.test(domain))
    throw new ApiError(503, 'Администратору нужно настроить BITRIX_DOMAIN для облачного портала.');
  return domain;
}
export async function bitrixCall(env: AppEnv, request: Request, method: 'user.current' | 'user.get', params: Record<string,string> = {}) {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]{10,2048})$/)?.[1];
  if (!token) throw new ApiError(401, 'Откройте приложение из Битрикс24.');
  let response: Response;
  try { response = await fetch(`https://${portalDomain(env)}/rest/${method}.json`, { method:'POST', body: new URLSearchParams({ ...params, auth: token }), redirect:'error', signal: AbortSignal.timeout(12000) }); }
  catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(502, 'Битрикс24 временно недоступен. Данные формы сохранены на экране.'); }
  let data: any;
  try { data = await response.json(); } catch { throw new ApiError(502, 'Не удалось прочитать ответ Битрикс24.'); }
  if (data.error === 'expired_token' || data.error === 'invalid_token' || response.status === 401) throw new ApiError(401, 'Сессия Битрикс24 истекла. Обновите авторизацию.');
  if (!response.ok || data.error) throw new ApiError(502, 'Битрикс24 не разрешил запрос. Проверьте доступ приложения к пользователям.');
  return data;
}
export async function authenticate(request: Request, env: AppEnv): Promise<User> {
  if (mode(env) === 'demo') {
    await seedDemo(env);
    const id = request.headers.get('X-Demo-User') || 'demo:1';
    const user = await first<User>(env, "SELECT * FROM users WHERE id=? AND tenant='demo'", id);
    if (!user) throw new ApiError(401, 'Выберите сотрудника демонстрационного проекта.');
    return user;
  }
  const tenant = portalDomain(env);
  const { result } = await bitrixCall(env, request, 'user.current');
  if (!result?.ID || !/^\d+$/.test(String(result.ID)) || result.ACTIVE === false || result.ACTIVE === 'N' || result.ACTIVE === '0' || result.ACTIVE === 0) throw new ApiError(401, 'Не удалось подтвердить сотрудника Битрикс24.');
  const id = `${tenant}:${result.ID}`;
  const role = (env.BITRIX_ADMIN_IDS || '').split(',').map(v=>v.trim()).includes(String(result.ID)) ? 'admin' : 'member';
  const name = [result.NAME, result.LAST_NAME].filter(Boolean).join(' ').slice(0,150) || `Сотрудник ${result.ID}`;
  await env.DB.batch([
    statement(env,'INSERT OR IGNORE INTO tenants (id) VALUES (?)',tenant),
    statement(env,'INSERT INTO users (id,tenant,name,external_id,global_role) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, global_role=excluded.global_role',id,tenant,name,String(result.ID),role),
    ...categoryStatements(env, tenant),
  ]);
  return { id, tenant, name, external_id:String(result.ID), global_role:role };
}
