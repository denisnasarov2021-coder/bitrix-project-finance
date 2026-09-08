/** Monetary values are integer kopecks. No floating-point parsing of money. */
export const MAX_AMOUNT = 999_999_999_999;
export type FinancialRow = { amount: number; kind: 'income' | 'expense'; expense_class?: string; deleted_at?: string | null };
export function parseMoney(value: unknown): number {
  if (typeof value !== 'string') throw new Error('Введите сумму числом, например 12 500,50');
  const normalized = value.trim().replace(/[ \u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) throw new Error('Сумма должна быть положительной, не более двух знаков после запятой');
  const [whole, fraction = ''] = normalized.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT) throw new Error('Сумма должна быть от 0,01 до 9 999 999 999,99 ₽');
  return cents;
}
export function metrics(rows: FinancialRow[]) {
  let income = 0, expenses = 0, dividends = 0;
  for (const row of rows) {
    if (row.deleted_at) continue;
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > MAX_AMOUNT) throw new Error('Некорректная сумма в данных');
    if (row.kind === 'income') income += row.amount;
    else if (row.kind === 'expense') { expenses += row.amount; if (row.expense_class === 'distribution') dividends += row.amount; }
    else throw new Error('Неизвестный тип операции');
    if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expenses)) throw new Error('Сумма превышает точность расчёта');
  }
  const profit = income - expenses;
  return { income, expenses, dividends, profit, operatingProfit: profit + dividends, margin: income === 0 ? null : profit / income * 100 };
}
export function money(cents: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
}
export function percent(value: number | null) { return value === null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%'; }
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') return false;
  const date = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
