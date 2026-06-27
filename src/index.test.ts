import { expect, test } from 'vitest';
import { asyncMemo } from './index';

test('asyncMemo', async () => {
  let called = 0;
  const cachedFn = asyncMemo(async () => {
    called += 1;
    return called;
  });
  await cachedFn.call();
  await cachedFn.call();
  expect(await cachedFn.call()).toBe(1);
  expect(called).toBe(1);
});

test('prune removes expired entries', async () => {
  let called = 0;
  const cachedFn = asyncMemo(
    async (id: number) => {
      called += 1;
      return called;
    },
    { resolver: (id: number) => `${id}` },
  );

  // Cache with short TTL (already expired)
  cachedFn.cache.set('expired', {
    key: 'expired',
    promise: Promise.resolve(1),
    settled: true,
    value: 1,
    expiresAt: Date.now() - 1000,
  });

  // Cache with long TTL (still fresh)
  cachedFn.cache.set('fresh', {
    key: 'fresh',
    promise: Promise.resolve(2),
    settled: true,
    value: 2,
    expiresAt: Date.now() + 60_000,
  });

  // Cache that never expires
  cachedFn.cache.set('permanent', {
    key: 'permanent',
    promise: Promise.resolve(3),
    settled: true,
    value: 3,
    expiresAt: -1,
  });

  cachedFn.prune();

  expect(cachedFn.cache.get('expired')).toBeUndefined();
  expect(cachedFn.cache.get('fresh')?.value).toBe(2);
  expect(cachedFn.cache.get('permanent')?.value).toBe(3);
});
