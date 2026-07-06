import test from 'node:test';
import assert from 'node:assert/strict';
import { calcSettlementBreakdown } from './settlement.js';

const baseCard = (overrides) => ({
  id: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  card_name: 'entry',
  purchase_price: 0,
  grading_fee: 0,
  shipping_to_grader: 0,
  shipping_from_grader: 0,
  insurance: 0,
  other_costs: 0,
  paid_by: 'Quez',
  split_percent: 50,
  ...overrides,
});

test('transfer from debtor to creditor settles an existing balance instead of doubling it', () => {
  const breakdown = calcSettlementBreakdown([
    baseCard({ purchase_price: 100, paid_by: 'Quez' }),
    baseCard({ id: 2, type: 'transfer', transfer_from: 'Stevie', transfer_to: 'Quez', transfer_amount: 50 }),
  ], 'quez');

  assert.equal(breakdown.owesDirection, 'even');
  assert.equal(breakdown.owesAmount, 0);
  assert.equal(breakdown.currentUserBalance, 0);
  assert.equal(breakdown.otherUserBalance, 0);
});

test('transfer from current user to other user reduces current users debt', () => {
  const breakdown = calcSettlementBreakdown([
    baseCard({ purchase_price: 100, paid_by: 'Stevie' }),
    baseCard({ id: 2, type: 'transfer', transfer_from: 'Quez', transfer_to: 'Stevie', transfer_amount: 50 }),
  ], 'quez');

  assert.equal(breakdown.owesDirection, 'even');
  assert.equal(breakdown.owesAmount, 0);
  assert.equal(breakdown.currentUserBalance, 0);
  assert.equal(breakdown.otherUserBalance, 0);
});

test('unsplit sale revenue collected by one user reduces that collectors net debt', () => {
  const breakdown = calcSettlementBreakdown([
    baseCard({ type: 'profit', sale_price: 100, paid_by: 'Quez' }),
  ], 'quez');

  assert.equal(breakdown.currentUserProfitCollected, 100);
  assert.equal(breakdown.otherUserProfitCollected, 0);
  assert.equal(breakdown.owesDirection, 'you_owe');
  assert.equal(breakdown.owesAmount, 50);
});

test('Both expense uses split_percent as actual paid shares', () => {
  const breakdown = calcSettlementBreakdown([
    baseCard({ purchase_price: 100, paid_by: 'Both', split_percent: 70 }),
  ], 'quez');

  assert.equal(breakdown.currentUserExpensesPaid, 70);
  assert.equal(breakdown.otherUserExpensesPaid, 30);
  assert.equal(breakdown.owesDirection, 'they_owe');
  assert.equal(breakdown.owesAmount, 20);
});
