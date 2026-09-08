import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, metrics, validDate, MAX_AMOUNT } from '../lib/finance.ts';
test('money: exact kopecks, comma/point and Russian grouping',()=>{
  assert.equal(parseMoney('12 500,50'),1250050);
  assert.equal(parseMoney('12\u202f500.5'),1250050);
  assert.equal(parseMoney('0.10')+parseMoney('0.20'),30);
  assert.equal(parseMoney('9999999999.99'),MAX_AMOUNT);
});
test('money: rejects zero, negatives, excessive precision, exponent and overflow',()=>{
  for(const value of ['0','-1','1.001','1e3','NaN','Infinity','10000000000','1,2,3','',undefined,12.50])assert.throws(()=>parseMoney(value),String(value));
});
test('project economics: includes dividends and preserves operating result',()=>{
  const m=metrics([{kind:'income',amount:30000000},{kind:'expense',amount:13500000},{kind:'expense',amount:2000000,expense_class:'distribution'}]);
  assert.deepEqual(m,{income:30000000,expenses:15500000,dividends:2000000,profit:14500000,operatingProfit:16500000,margin:145/300*100});
});
test('zero revenue, loss, empty project and deleted operations',()=>{
  assert.equal(metrics([]).margin,null);
  const m=metrics([{kind:'expense',amount:10000},{kind:'income',amount:40000,deleted_at:'2026-09-08'}]);
  assert.equal(m.profit,-10000);assert.equal(m.margin,null);
  assert.equal(metrics([{kind:'income',amount:100},{kind:'expense',amount:150}]).margin,-50);
});
test('portfolio profitability is weighted through totals',()=>{
  const m=metrics([{kind:'income',amount:10000},{kind:'expense',amount:5000},{kind:'income',amount:100000},{kind:'expense',amount:90000}]);
  assert.equal(m.margin,15000/110000*100);
  assert.notEqual(m.margin,30);
});
test('date: leap years and actual calendar days',()=>{
  assert.equal(validDate('2024-02-29'),true);
  for(const value of ['2025-02-29','2026-04-31','2026-13-01','2026-1-01','1999-12-31','2101-01-01','2026-09-01T00:00:00Z'])assert.equal(validDate(value),false,value);
});
