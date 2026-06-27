export interface CacheContext<U> {
  call(): Promise<U>;
  /** Return the currently cached value immediately. */
  get(): U | undefined;
  /** Override the cache with the specified value. */
  set(value: U, ttl?: number): void;
  /** Delete the currently cached value. */
  delete(): void;
  /** Invalidate the current cached value and send a new request without deleting the old value. */
  reload(): Promise<U>;
  /** Whether the latest request is settled. */
  isSettled(): boolean;
  /** Whether the value returned by `get` is fresh. */
  isFresh(): boolean;
}

type CachePrimitiveKey = string | number | undefined;
type CacheKeyTuple = [cacheGroup: string, cacheKey: string];

export interface CacheOptions<T extends unknown[]> {
  /**
   * Convert args into `cacheGroup` and `cacheKey`.
   * If `cacheKey` is not provided, `cacheGroup` will be used.
   * By default the args are ignored and the function is only evaluated once.
   *
   * Each `cacheGroup` stores a cached value, `cacheKey` determines whether the value is stale and needs to be reloaded.
   *
   * @returns `cacheGroup` or `[cacheGroup, cacheKey]`.
   */
  resolver: (
    ...args: T
  ) =>
    | CachePrimitiveKey
    | [cacheGroup: CachePrimitiveKey, cacheKey: CachePrimitiveKey];
  /**
   * Whether stale value should be returned.
   */
  mustRevalidate: boolean;
  /**
   * Time to live in ms, -1 for always. Default as `-1`.
   */
  ttl: number;
}

export interface CacheData<U = unknown> {
  key: string;
  promise: Promise<U>;
  settled: boolean;
  value?: U;
  expiresAt: number;
}

export interface CacheStorage<U = unknown> {
  get(cacheGroup: string): CacheData<U> | undefined;
  set(cacheGroup: string, data?: CacheData<U>): void;
  keys(): IterableIterator<string>;
  clear(): void;
}

// Sentinel values for cache expiration
const NEVER_EXPIRES = -1;
const EXPIRED_IMMEDIATELY = 0;

const defaultOptions: CacheOptions<unknown[]> = {
  mustRevalidate: false,
  resolver: () => '',
  ttl: NEVER_EXPIRES,
};

export function createAsyncMemoStorage() {
  return new Map<string, CacheData<unknown>>();
}

export class AsyncMemoContext<
  T extends unknown[],
  U,
  S extends CacheStorage = ReturnType<typeof createAsyncMemoStorage>,
> {
  cache: S;
  private fn: (...args: T) => Promise<U>;
  private mustRevalidate: boolean;
  private resolver: CacheOptions<T>['resolver'];
  private ttl: number;

  constructor(
    fn: (...args: T) => Promise<U>,
    options?: Partial<CacheOptions<T>>,
    cacheFactory?: () => S,
  ) {
    this.fn = fn;
    this.cache = (cacheFactory || createAsyncMemoStorage)() as S;
    const opts = { ...defaultOptions, ...options };
    this.mustRevalidate = opts.mustRevalidate;
    this.resolver = opts.resolver;
    this.ttl = opts.ttl;
  }

  // --- Key resolution ---

  private resolveKey(...args: T): CacheKeyTuple {
    const res = this.resolver(...args);
    const keys = Array.isArray(res) ? res : ([res, res] as CacheKeyTuple);
    return keys.map((key) => `${key ?? ''}`) as CacheKeyTuple;
  }

  // --- Internal cache operations (key-based) ---

  private getCachedData([cacheGroup, cacheKey]: CacheKeyTuple):
    | CacheData<U>
    | undefined {
    const data = this.cache.get(cacheGroup) as CacheData<U> | undefined;
    return data?.key === cacheKey ? data : undefined;
  }

  private isSettledByKey(key: CacheKeyTuple): boolean {
    return this.getCachedData(key)?.settled ?? false;
  }

  private isFreshByKey(key: CacheKeyTuple): boolean {
    const data = this.getCachedData(key);
    if (!data?.settled) return false;
    return data.expiresAt < 0 || data.expiresAt > Date.now();
  }

  private getByKey(key: CacheKeyTuple): U | undefined {
    const data = this.getCachedData(key);
    if (data && (!this.mustRevalidate || this.isFreshByKey(key))) {
      return data.value;
    }
  }

  private computeExpiresAt(valueTtl: number): number {
    return valueTtl < 0 ? valueTtl : Date.now() + valueTtl;
  }

  private setByKey([cacheGroup, cacheKey]: CacheKeyTuple, value?: U, valueTtl?: number): void {
    const ttl = valueTtl ?? this.ttl;
    this.cache.set(cacheGroup, {
      key: cacheKey,
      ...this.cache.get(cacheGroup),
      promise: value == null ? Promise.reject() : Promise.resolve(value),
      value,
      expiresAt: this.computeExpiresAt(ttl),
      settled: true,
    });
  }

  private removeByKey([cacheGroup]: CacheKeyTuple): void {
    this.cache.set(cacheGroup);
  }

  private createPendingEntry(
    [cacheGroup, cacheKey]: CacheKeyTuple,
    promise: Promise<U>,
    oldData?: CacheData<U>,
  ): CacheData<U> {
    const pending: CacheData<U> = {
      ...oldData,
      key: cacheKey,
      promise,
      expiresAt: NEVER_EXPIRES,
      settled: false,
    };
    this.cache.set(cacheGroup, pending);
    return pending;
  }

  private onSettled(
    [cacheGroup]: CacheKeyTuple,
    pending: CacheData<U>,
    error: boolean,
    value?: U,
  ): void {
    if (this.cache.get(cacheGroup) !== pending) {
      return;
    }
    this.cache.set(cacheGroup, {
      ...pending,
      value,
      expiresAt: error ? EXPIRED_IMMEDIATELY : this.computeExpiresAt(this.ttl),
      settled: true,
    });
  }

  private reloadByKey(key: CacheKeyTuple, args: T): Promise<U> {
    const promise = this.fn(...args);
    const pending = this.createPendingEntry(key, promise, this.getCachedData(key));
    promise.then(
      (value) => this.onSettled(key, pending, false, value),
      () => this.onSettled(key, pending, true),
    );
    return promise;
  }

  private callByKey(key: CacheKeyTuple, args: T): Promise<U> {
    const data = this.getCachedData(key);
    if (data && (this.isFreshByKey(key) || !this.isSettledByKey(key))) {
      return data.promise;
    }
    return this.reloadByKey(key, args);
  }

  // --- Public API (args-based, arrow functions for safe destructuring) ---

  isSettled = (...args: T): boolean => {
    return this.isSettledByKey(this.resolveKey(...args));
  };

  isFresh = (...args: T): boolean => {
    return this.isFreshByKey(this.resolveKey(...args));
  };

  get = (...args: T): U | undefined => {
    return this.getByKey(this.resolveKey(...args));
  };

  remove = (...args: T): void => {
    this.removeByKey(this.resolveKey(...args));
  };

  reload = (...args: T): Promise<U> => {
    const key = this.resolveKey(...args);
    return this.reloadByKey(key, args);
  };

  call = (...args: T): Promise<U> => {
    const key = this.resolveKey(...args);
    return this.callByKey(key, args);
  };

  getContext = (...args: T): CacheContext<U> => {
    const key = this.resolveKey(...args);
    return {
      call: () => this.callByKey(key, args),
      get: () => this.getByKey(key),
      set: (value: U, ttl = NEVER_EXPIRES) => {
        this.setByKey(key, value, ttl);
      },
      delete: () => this.removeByKey(key),
      reload: () => this.reloadByKey(key, args),
      isSettled: () => this.isSettledByKey(key),
      isFresh: () => this.isFreshByKey(key),
    };
  }

  prepare = (...args: T): CacheContext<U> => {
    return this.getContext(...args);
  };

  clear = (): void => {
    this.cache.clear();
  };

  prune = (): void => {
    const now = Date.now();
    for (const cacheGroup of this.cache.keys()) {
      const data = this.cache.get(cacheGroup);
      if (data && data.settled && data.expiresAt > 0 && data.expiresAt < now) {
        this.cache.set(cacheGroup);
      }
    }
  }
}

// --- Public exports ---

export function createAsyncMemo<
  S extends CacheStorage = ReturnType<typeof createAsyncMemoStorage>,
>(cacheFactory?: () => S) {
  return <U, T extends unknown[]>(
    fn: (...args: T) => Promise<U>,
    options?: Partial<CacheOptions<T>>,
  ): AsyncMemoContext<T, U, S> => {
    return new AsyncMemoContext(fn, options, cacheFactory);
  };
}

export const asyncMemo = createAsyncMemo();
