import { expect, test } from 'vitest';
import { asyncMemo } from './index';

test('asyncMemo', async () => {
  let called = 0;
  const cachedFn = asyncMemo(async () => {
    called += 1;
    return called;
  });
  await cachedFn();
  await cachedFn();
  expect(await cachedFn()).toBe(1);
  expect(called).toBe(1);
});
