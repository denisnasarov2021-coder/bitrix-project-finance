import { first, statement } from './types.ts';
import type { AppEnv } from './types.ts';
export const DEFAULT_CATEGORIES = [
  ['revenue', 'Оплата клиента', 'income', 'operating'],
  ['external', 'Внешние программисты', 'expense', 'operating'],
  ['internal', 'Внутренние программисты', 'expense', 'operating'],
  ['ai', 'Расходы на ИИ', 'expense', 'operating'],
  ['server', 'Аренда сервера', 'expense', 'operating'],
  ['dividends', 'Дивиденды', 'expense', 'distribution'],
];
export function categoryStatements(env: AppEnv, tenant: string) {
  return DEFAULT_CATEGORIES.map(([id, name, kind, cls]) => statement(env, 'INSERT OR IGNORE INTO categories (id,tenant,name,normalized,kind,expense_class) VALUES (?,?,?,?,?,?)', `${tenant}:${id}`, tenant, name, name.toLocaleLowerCase('ru-RU'), kind, cls));
}
export async function seedDemo(env: AppEnv) {
  if (await first(env, "SELECT id FROM tenants WHERE id='demo'")) return;
  const now = '2026-09-01T09:00:00.000Z';
  const s = [statement(env, "INSERT OR IGNORE INTO tenants (id) VALUES ('demo')")];
  for (const [id, name, role] of [['1', 'Анна Смирнова', 'admin'], ['2', 'Михаил Волков', 'member'], ['3', 'Елена Орлова', 'member'], ['4', 'Игорь Соколов', 'member']])
    s.push(statement(env, 'INSERT OR IGNORE INTO users (id,tenant,name,global_role) VALUES (?,?,?,?)', `demo:${id}`, 'demo', name, role));
  s.push(...categoryStatements(env, 'demo'));
  for (const [id, name, client, description] of [
    ['crm', 'CRM для «Вектор»', 'Вектор', 'Настройка воронок, распределение заявок и отчётность по оплатам.'],
    ['support', 'Поддержка «Альфа»', 'Альфа', 'Сопровождение портала Битрикс24 и доработка автоматизации.'],
    ['integration', 'Интеграция с 1С', 'Норд', 'Синхронизация сделок, счетов и оплат.']]) {
    s.push(statement(env, 'INSERT OR IGNORE INTO projects (id,tenant,name,client,description,created_by,created_at) VALUES (?,?,?,?,?,?,?)', `demo:${id}`, 'demo', name, client, description, 'demo:1', now));
    s.push(statement(env, 'INSERT OR IGNORE INTO members (project_id,user_id,role) VALUES (?,?,?)', `demo:${id}`, 'demo:1', 'manager'));
  }
  for (const [p,u,role] of [['crm','2','editor'], ['crm','3','viewer'], ['support','2','manager'], ['support','4','editor'], ['integration','3','editor']])
    s.push(statement(env, 'INSERT OR IGNORE INTO members (project_id,user_id,role) VALUES (?,?,?)', `demo:${p}`, `demo:${u}`, role));
  const data: [string,string,number,string,string][] = [
    ['crm','revenue',18000000,'2026-09-01','Первый этап: аудит и настройка CRM'],
    ['crm','revenue',12000000,'2026-09-07','Второй этап: автоматизация'],
    ['crm','external',7000000,'2026-09-03','Интеграция сайта и телефонии'],
    ['crm','internal',5500000,'2026-09-04','Настройка воронок и роботов'],
    ['crm','ai',500000,'2026-09-05','ИИ-инструменты для разработки'],
    ['crm','server',500000,'2026-09-06','Сервер приложения'],
    ['crm','dividends',2000000,'2026-09-08','Выплата участникам'],
    ['support','revenue',12000000,'2026-09-01','Ежемесячное сопровождение'],
    ['support','internal',7500000,'2026-09-03','Поддержка и обучение'],
    ['support','ai',300000,'2026-09-05','Подписки на ИИ'],
    ['support','server',200000,'2026-09-06','Хостинг интеграций'],
    ['integration','revenue',8000000,'2026-09-02','Аванс по договору'],
    ['integration','external',6500000,'2026-09-04','Разработка обмена с 1С'],
    ['integration','internal',3000000,'2026-09-05','Аналитика и тестирование'],
  ];
  data.forEach(([p,c,amount,date,note], i) => s.push(statement(env, 'INSERT OR IGNORE INTO entries (id,tenant,project_id,category_id,amount,date,note,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', `demo:entry:${i+1}`, 'demo', `demo:${p}`, `demo:${c}`, amount,date,note,'demo:1','demo:1',now,now)));
  await env.DB.batch(s);
}
