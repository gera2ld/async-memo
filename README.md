# @gera2ld/async-memo

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]

## Usage

### Quick Start

```ts
import { asyncMemo } from '@gera2ld/async-memo';

const myApi = asyncMemo(myApiCall, {
  resolver: (params) => [groupKey, cacheKey],
});

// Call from anywhere
async function someAction() {
  const response = await myApi.call(params);
}

// Get the current value anytime
function getValueSync() {
  return myApi.get(params);
}

// Prepare a bound context to avoid passing args around
function otherPlace() {
  const ctx = myApi.prepare(params);
  ctx.get();        // sync get
  ctx.reload();     // refresh data
  ctx.isSettled();  // check loading state
  ctx.set(value);   // override cache
}
```

Each `groupKey` has its own cache. The cache is invalidated when the `cacheKey` changes.

### Options

```ts
interface CacheOptions<T extends unknown[]> {
  /** Convert args into cacheGroup and cacheKey.
   * By default the function is only evaluated once. */
  resolver: (...args: T) => string | [cacheGroup: string, cacheKey: string];
  /** Whether stale value should be returned. Default: false */
  mustRevalidate: boolean;
  /** Time to live in ms, -1 for always. Default: -1 */
  ttl: number;
}
```

### Use Cases

#### Load once globally

This is the default behavior.

```ts
const loadOnceGlobally = asyncMemo(api);
// or
const loadOnceGlobally = asyncMemo(api, {
  resolver: () => '',
});
```

#### Load on param change

```ts
const loadOnParamChange = asyncMemo(api, {
  resolver: (params) => ['', JSON.stringify(params)],
});
```

#### Cache data for multiple tabs

The data for each tab will be cached in a different group, with the parameters as its cache key.

```ts
const loadOnParamChange = asyncMemo(api, {
  resolver: (params) => [params.tab, JSON.stringify(params)],
});
```

### Custom Cache Store

For frameworks like MobX or Vue, you can provide a custom cache store:

```ts
import { createAsyncMemo } from '@gera2ld/async-memo';

function createCache<T>() {
  // ... your cache implementation
  return {
    get(cacheKey: string) { ... },
    set(cacheKey: string, data?: T) { ... },
    keys(): IterableIterator<string> { ... },
    clear() { ... },
  };
}

const asyncMemo = createAsyncMemo(createCache);
```

<details>
<summary>MobX example</summary>

```ts
import { observable } from 'mobx';

function createCache<T>() {
  const target = observable<{ value: Record<string, T | undefined> }>(
    { value: {} },
    { value: observable.ref },
  );
  return {
    get(cacheKey: string) {
      return target.value[cacheKey];
    },
    set(cacheKey: string, data?: T) {
      target.value = { ...target.value, [cacheKey]: data };
    },
    *keys() {
      yield* Object.keys(target.value);
    },
    clear() {
      target.value = {};
    },
  };
}
```

</details>

<details>
<summary>Vue example</summary>

```ts
import { ref } from 'vue';

function createCache<T>() {
  const target = ref<Record<string, T | undefined>>({});
  return {
    get(cacheKey: string) {
      return target.value[cacheKey];
    },
    set(cacheKey: string, data?: T) {
      target.value = { ...target.value, [cacheKey]: data };
    },
    *keys() {
      yield* Object.keys(target.value);
    },
    clear() {
      target.value = {};
    },
  };
}
```

</details>

[npm-version-src]: https://img.shields.io/npm/v/@gera2ld/async-memo?style=flat&colorA=18181B&colorB=F0DB4F
[npm-version-href]: https://npmjs.com/package/@gera2ld/async-memo
[npm-downloads-src]: https://img.shields.io/npm/dm/@gera2ld/async-memo?style=flat&colorA=18181B&colorB=F0DB4F
[npm-downloads-href]: https://npmjs.com/package/@gera2ld/async-memo
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@gera2ld/async-memo?style=flat&colorA=18181B&colorB=F0DB4F
[bundle-href]: https://bundlephobia.com/result?p=@gera2ld/async-memo
[jsdocs-src]: https://img.shields.io/badge/jsDocs.io-reference-18181B?style=flat&colorA=18181B&colorB=F0DB4F
[jsdocs-href]: https://www.jsdocs.io/package/@gera2ld/async-memo
