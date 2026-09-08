import { metrics, parseMoney, validDate } from '../finance.ts';
import { authenticate, bitrixCall, mode } from './auth.ts';
import { ApiError, first, rows, statement } from './types.ts';
import type { AppEnv, User } from './types.ts';
function textValue(value: unknown, label: string, max = 150, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new ApiError(422, `${label}: ${required ? 'заполните поле, ' : ''}максимум ${max} символов`);
  return value.trim();
}
async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ApiError(415, 'Ожидается JSON.');
  const raw = await request.text();
  if (raw.length > 16000) throw new ApiError(413, 'Слишком большой запрос.');
  try { const value = JSON.parse(raw); if (!value || Array.isArray(value) || typeof value !== 'object') throw 0; return value; }
  catch { throw new ApiError(400, 'Некорректный JSON.'); }
}
async function projectAccess(env: AppEnv, user: User, id: string, level: 'view' | 'edit' | 'manage' = 'view') {
  const project = await first<any>(env, 'SELECT p.*, m.role FROM projects p LEFT JOIN members m ON m.project_id=p.id AND m.user_id=? WHERE p.id=? AND p.tenant=?', user.id, id, user.tenant);
  if (!project || (!project.role && user.global_role !== 'admin')) throw new ApiError(404, 'Проект не найден или доступ закрыт.');
  const role = user.global_role === 'admin' ? 'manager' : project.role;
  if ((level === 'edit' && role === 'viewer') || (level === 'manage' && role !== 'manager')) throw new ApiError(403, 'Недостаточно прав для этого действия.');
  return { ...project, role };
}
function auditMember(env: AppEnv, user: User, project: string, entity: string, action: string, before: unknown, after: unknown) {
  return statement(env, 'INSERT INTO audit (tenant,project_id,entity_id,action,actor_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)', user.tenant,project,entity,action,user.id,JSON.stringify(before),JSON.stringify(after),new Date().toISOString());
}
async function entryValues(env: AppEnv, user: User, input: any) {
  const categoryId = textValue(input.categoryId, 'Статья');
  const category = await first(env,'SELECT id FROM categories WHERE id=? AND tenant=?',categoryId,user.tenant);
  if (!category) throw new ApiError(422,'Выберите существующую статью.');
  let amount: number; try { amount = parseMoney(input.amount); } catch (e) { throw new ApiError(422,(e as Error).message); }
  if (!validDate(input.date)) throw new ApiError(422,'Введите действительную дату от 2000 до 2100 года.');
  const note = textValue(input.note ?? '', 'Комментарий', 1000, false);
  return { categoryId, amount, date: input.date, note };
}
const ENTRY_QUERY = `SELECT e.*, c.name category_name, c.kind, c.expense_class, u.name author_name FROM entries e JOIN categories c ON e.category_id=c.id JOIN users u ON e.updated_by=u.id`;
async function dispatch(request: Request, env: AppEnv) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (path === '/api/config' && request.method === 'GET') return { mode: mode(env) };
  const user = await authenticate(request, env);
  if (path === '/api/state' && request.method === 'GET') {
    // A D1 batch gives one consistent snapshot for projects, entries and rights.
    const snapshot = await env.DB.batch([
      statement(env, "SELECT p.*, m.role FROM projects p LEFT JOIN members m ON m.project_id=p.id AND m.user_id=? WHERE p.tenant=? AND (?='admin' OR m.user_id IS NOT NULL) ORDER BY p.created_at,p.name", user.id,user.tenant,user.global_role),
      statement(env, `${ENTRY_QUERY} WHERE e.tenant=? AND e.deleted_at IS NULL AND (?='admin' OR EXISTS(SELECT 1 FROM members m WHERE m.project_id=e.project_id AND m.user_id=?)) ORDER BY e.date DESC,e.created_at DESC`,user.tenant,user.global_role,user.id),
      statement(env, "SELECT m.*,u.name,u.external_id FROM members m JOIN users u ON u.id=m.user_id JOIN projects p ON p.id=m.project_id WHERE p.tenant=? AND (?='admin' OR EXISTS(SELECT 1 FROM members own WHERE own.project_id=p.id AND own.user_id=?))",user.tenant,user.global_role,user.id),
      statement(env, 'SELECT * FROM categories WHERE tenant=? ORDER BY kind,name',user.tenant),
      statement(env, 'SELECT id,name,global_role,external_id FROM users WHERE tenant=? ORDER BY name',user.tenant),
    ]);
    const [projects,allEntries,allMembers,categories,users] = snapshot.map(r=>r.results || []);
    return { user, mode:mode(env), projects:projects.map(p=>({...p,role:user.global_role==='admin'?'manager':p.role,summary:metrics(allEntries.filter(e=>e.project_id===p.id))})), entries:allEntries, members:allMembers, categories, users, serverTime:new Date().toISOString() };
  }
  if (path === '/api/projects' && request.method === 'POST') {
    const input = await body(request); const name = textValue(input.name,'Название проекта');
    const client = textValue(input.client ?? '','Клиент',150,false); const description = textValue(input.description ?? '','Описание',1000,false);
    const id = crypto.randomUUID(); const now = new Date().toISOString();
    await env.DB.batch([
      statement(env,'INSERT INTO projects (id,tenant,name,client,description,created_by,created_at) VALUES (?,?,?,?,?,?,?)',id,user.tenant,name,client,description,user.id,now),
      statement(env,'INSERT INTO members (project_id,user_id,role) VALUES (?,?,?)',id,user.id,'manager'),
      auditMember(env,user,id,id,'project_create',null,{name,client,description}),
    ]);
    return { id };
  }
  if (path === '/api/categories' && request.method === 'POST') {
    const input = await body(request);
    // A global article affects every project; managers and administrators may add it.
    const manager = await first(env,"SELECT project_id FROM members WHERE user_id=? AND role='manager'",user.id);
    if (user.global_role !== 'admin' && !manager) throw new ApiError(403,'Новые статьи добавляет руководитель проекта или администратор.');
    const name = textValue(input.name,'Название статьи',100);
    if (!['income','expense'].includes(input.kind)) throw new ApiError(422,'Выберите доход или расход.');
    const id = crypto.randomUUID();
    const exists = await first(env,'SELECT id FROM categories WHERE tenant=? AND kind=? AND normalized=?',user.tenant,input.kind,name.toLocaleLowerCase('ru-RU'));
    if (exists) throw new ApiError(409,'Такая статья уже существует.');
    try { await statement(env,'INSERT INTO categories (id,tenant,name,normalized,kind,expense_class) VALUES (?,?,?,?,?,?)',id,user.tenant,name,name.toLocaleLowerCase('ru-RU'),input.kind,'operating').run(); }
    catch (e) { if (String(e).includes('UNIQUE')) throw new ApiError(409,'Такая статья уже существует.'); throw e; }
    return { id };
  }
  if (path === '/api/entries' && request.method === 'POST') {
    const input = await body(request); const projectId = textValue(input.projectId,'Проект');
    await projectAccess(env,user,projectId,'edit');
    if (typeof input.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.id)) throw new ApiError(422,'Не задан идентификатор операции.');
    const v = await entryValues(env,user,input); const now = new Date().toISOString();
    await statement(env,'INSERT OR IGNORE INTO entries (id,tenant,project_id,category_id,amount,date,note,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',input.id,user.tenant,projectId,v.categoryId,v.amount,v.date,v.note,user.id,user.id,now,now).run();
    const saved = await first<any>(env,'SELECT * FROM entries WHERE id=? AND tenant=?',input.id,user.tenant);
    if (!saved || saved.project_id!==projectId || saved.created_by!==user.id || saved.category_id!==v.categoryId || saved.amount!==v.amount || saved.date!==v.date || saved.note!==v.note || saved.deleted_at) throw new ApiError(409,'Этот идентификатор уже использован для другой операции.');
    return { id:saved.id, version:saved.version };
  }
  const entryMatch = path.match(/^\/api\/entries\/([^/]+)$/);
  if (entryMatch && ['PATCH','DELETE'].includes(request.method)) {
    const id = decodeURIComponent(entryMatch[1]);
    const entry = await first<any>(env,'SELECT * FROM entries WHERE id=? AND tenant=?',id,user.tenant);
    if (!entry) throw new ApiError(404,'Операция не найдена.');
    await projectAccess(env,user,entry.project_id,'edit');
    const input = await body(request);
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new ApiError(422,'Не задана версия операции.');
    const now = new Date().toISOString();
    const v = request.method==='PATCH' ? await entryValues(env,user,input) : null;
    const result = v
      ? await statement(env,'UPDATE entries SET category_id=?,amount=?,date=?,note=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND tenant=? AND version=? AND deleted_at IS NULL RETURNING id,version',v.categoryId,v.amount,v.date,v.note,user.id,now,id,user.tenant,input.version).first()
      : await statement(env,'UPDATE entries SET deleted_at=?,updated_by=?,updated_at=?,version=version+1 WHERE id=? AND tenant=? AND version=? AND deleted_at IS NULL RETURNING id,version',now,user.id,now,id,user.tenant,input.version).first();
    if (!result) throw new ApiError(409,'Операция уже изменена другим сотрудником. Обновите список и откройте её заново.');
    return { id, version:input.version+1 };
  }
  const memberMatch = path.match(/^\/api\/projects\/([^/]+)\/members$/);
  if (memberMatch && ['POST','DELETE'].includes(request.method)) {
    const projectId = decodeURIComponent(memberMatch[1]);
    await projectAccess(env,user,projectId,'manage'); const input = await body(request);
    const employee = await first<any>(env,'SELECT * FROM users WHERE id=? AND tenant=?',String(input.userId),user.tenant);
    if (!employee) throw new ApiError(422,'Сначала загрузите сотрудника из Битрикс24.');
    if (employee.id===user.id) throw new ApiError(422,'Собственную роль нельзя изменить или удалить.');
    const before = await first(env,'SELECT role FROM members WHERE project_id=? AND user_id=?',projectId,employee.id);
    if (request.method === 'POST') {
      if (!['manager','editor','viewer'].includes(input.role)) throw new ApiError(422,'Выберите роль сотрудника.');
      await env.DB.batch([
        statement(env,'INSERT INTO members (project_id,user_id,role) VALUES (?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role',projectId,employee.id,input.role),
        auditMember(env,user,projectId,employee.id,'member_save',before,{name:employee.name,role:input.role}),
      ]);
    } else {
      await env.DB.batch([
        statement(env,'DELETE FROM members WHERE project_id=? AND user_id=?',projectId,employee.id),
        auditMember(env,user,projectId,employee.id,'member_remove',before,{name:employee.name}),
      ]);
    }
    return { ok:true };
  }
  const auditMatch = path.match(/^\/api\/projects\/([^/]+)\/audit$/);
  if (auditMatch && request.method==='GET') {
    const id=decodeURIComponent(auditMatch[1]); await projectAccess(env,user,id);
    return { events:await rows(env,'SELECT a.*,u.name actor_name FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE a.tenant=? AND a.project_id=? ORDER BY a.id DESC LIMIT 100',user.tenant,id) };
  }
  if (path==='/api/directory' && request.method==='POST') {
    const manager = await first(env,"SELECT project_id FROM members WHERE user_id=? AND role='manager'",user.id);
    if (user.global_role!=='admin'&&!manager) throw new ApiError(403,'Сотрудников загружает руководитель проекта.');
    if (mode(env)==='demo') return { next:null };
    const input=await body(request); const start=input.start ?? 0;
    if (!Number.isSafeInteger(start)||start<0||start>100000) throw new ApiError(422,'Некорректная страница.');
    const response=await bitrixCall(env,request,'user.get',{'FILTER[ACTIVE]':'true','FILTER[USER_TYPE]':'employee','select[0]':'ID','select[1]':'NAME','select[2]':'LAST_NAME','select[3]':'ACTIVE',start:String(start)});
    if (!Array.isArray(response.result)) throw new ApiError(502,'Не удалось загрузить сотрудников.');
    const statements=response.result.filter((u:any)=>/^\d+$/.test(String(u.ID)) && ![false,'N','0',0].includes(u.ACTIVE)).map((u:any)=>statement(env,'INSERT INTO users (id,tenant,name,external_id,global_role) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',`${user.tenant}:${u.ID}`,user.tenant,[u.NAME,u.LAST_NAME].filter(Boolean).join(' ').slice(0,150)||`Сотрудник ${u.ID}`,String(u.ID),'member'));
    if (statements.length) await env.DB.batch(statements);
    return { next:Number.isSafeInteger(response.next)?response.next:null, count:statements.length };
  }
  throw new ApiError(404,'Действие не найдено.');
}
export async function handleApi(request: Request, env: AppEnv): Promise<Response> {
  try {
    // Mutations require JSON and same-origin Origin when present. Bearer tokens authenticate Bitrix users; no auth cookies are used.
    const origin = request.headers.get('Origin');
    if (request.method !== 'GET' && origin && origin !== new URL(request.url).origin) throw new ApiError(403,'Запрос с другого сайта запрещён.');
    const data = await dispatch(request,env);
    return Response.json(data,{headers:{'Cache-Control':'no-store'}});
  } catch (e) {
    if (!(e instanceof ApiError)) console.error('Finance API failure', e instanceof Error ? e.name : 'UnknownError');
    return Response.json({ error:e instanceof ApiError?e.message:'Не удалось выполнить действие. Повторите позже.' }, {status:e instanceof ApiError?e.status:500,headers:{'Cache-Control':'no-store'}});
  }
}
