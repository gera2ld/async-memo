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

export interface CachedFunction<
  T extends unknown[],
  U,
  S extends CacheStorage,
> {
  (...args: T): Promise<U>;

  /** Return the currently cached value immediately. */
  get(...args: T): U | undefined;

  /** Delete the currently cached value. */
  delete(...args: T): void;

  /** Invalidate the current cached value and send a new request without deleting the old value. */
  reload(...args: T): Promise<U>;

  /** Whether the latest request is settled. */
  isSettled(...args: T): boolean;

  /** Whether the value returned by `get` is fresh. */
  isFresh(...args: T): boolean;

  /** Clear cache. */
  clear(): void;

  /** Get the cache context so we don't need to pass `args` around. */
  context(...args: T): CacheContext<U>;

  /** The cache storage, only used for testing purpose. */
  cache: S;
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
   * Time to live, -1 for always. Default as `-1`.
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

const defaultOptions: CacheOptions<unknown[]> = {
  mustRevalidate: false,
  resolver: () => '',
  ttl: -1,
};

export interface CacheStorage<U = unknown> {
  get(cacheGroup: string): CacheData<U> | undefined;
  // getSubscriber?: (cacheGroup: string) => {
  //   subscribe(callback: (cachedData: CacheData<U>) => void): () => void;
  // };
  set(cacheGroup: string, data?: CacheData<U>): void;
  clear(): void;
}

export function createAsyncMemoStorage() {
  return new Map<string, CacheData<unknown>>();
}

export function createAsyncMemo<
  S extends CacheStorage = ReturnType<typeof createAsyncMemoStorage>,
>(cacheFactory?: () => S) {
  const asyncMemo = <U, T extends unknown[]>(
    fn: (...args: T) => Promise<U>,
    options?: Partial<CacheOptions<T>>,
  ): CachedFunction<T, U, S> => {
    const cache = (cacheFactory || createAsyncMemoStorage)() as S;
    const { mustRevalidate, resolver, ttl }: CacheOptions<T> = {
      ...defaultOptions,
      ...options,
    };
    const resolveKey = (...args: T): CacheKeyTuple => {
      const res = resolver(...args);
      const keys = Array.isArray(res) ? res : ([res, res] as CacheKeyTuple);
      return keys.map((key) => `${key ?? ''}`) as CacheKeyTuple;
    };
    const withArgs = <V>(keyFn: (keys: CacheKeyTuple, args: T) => V) => {
      return (...args: T) => {
        const keys = resolveKey(...args);
        return keyFn(keys, args);
      };
    };
    const isSettled = ([cacheGroup, cacheKey]: CacheKeyTuple) => {
      const cachedData = cache.get(cacheGroup) as CacheData<U> | undefined;
      return cachedData?.key === cacheKey && cachedData.settled;
    };
    const isFresh = ([cacheGroup, cacheKey]: CacheKeyTuple) => {
      const cachedData = cache.get(cacheGroup) as CacheData<U> | undefined;
      return (
        cachedData?.key === cacheKey &&
        cachedData.settled &&
        (cachedData.expiresAt < 0 || cachedData.expiresAt > Date.now())
      );
    };
    const get = ([cacheGroup, cacheKey]: CacheKeyTuple) => {
      const cachedData = cache.get(cacheGroup) as CacheData<U> | undefined;
      if (cachedData && (!mustRevalidate || isFresh([cacheGroup, cacheKey]))) {
        return cachedData.value;
      }
    };
    const set = (
      [cacheGroup, cacheKey]: CacheKeyTuple,
      value?: U,
      valueTtl = ttl,
    ) => {
      const expiresAt = valueTtl < 0 ? valueTtl : Date.now() + valueTtl;
      cache.set(cacheGroup, {
        key: cacheKey,
        ...cache.get(cacheGroup),
        promise: value == null ? Promise.reject() : Promise.resolve(value),
        value,
        expiresAt,
        settled: true,
      });
    };
    const delete_ = ([cacheGroup]: CacheKeyTuple) => {
      cache.set(cacheGroup);
    };
    const clear = () => {
      cache.clear();
    };
    const reload = ([cacheGroup, cacheKey]: CacheKeyTuple, args: T) => {
      const oldCache = cache.get(cacheGroup) as CacheData<U> | undefined;
      const promise = fn(...args);
      const cachedData: CacheData<U> = {
        ...oldCache,
        key: cacheKey,
        promise,
        // Set to -1 until the promise is either resolved or rejected
        expiresAt: -1,
        settled: false,
      };
      cache.set(cacheGroup, cachedData);
      const resolve = (error: boolean, value?: U) => {
        if (cache.get(cacheGroup) !== cachedData) {
          // cache has been updated, ignore invalidated data
          return;
        }
        let expiresAt: number;
        if (error) {
          expiresAt = 0;
        } else {
          expiresAt = ttl < 0 ? ttl : Date.now() + ttl;
        }
        cache.set(cacheGroup, {
          ...cachedData,
          value,
          expiresAt,
          settled: true,
        });
      };
      promise.then(
        (value) => {
          resolve(false, value);
        },
        () => {
          resolve(true);
        },
      );
      return promise;
    };
    const call = (key: CacheKeyTuple, args: T) => {
      const [cacheGroup, cacheKey] = key;
      const cachedData = cache.get(cacheGroup) as CacheData<U> | undefined;
      if (cachedData?.key === cacheKey && (isFresh(key) || !isSettled(key))) {
        return cachedData.promise;
      }
      return reload(key, args);
    };
    const getContext = (key: CacheKeyTuple, args: T) => {
      return {
        call: () => call(key, args),
        get: () => get(key),
        set: (value: U, ttl = -1) => {
          set(key, value, ttl);
        },
        delete: () => delete_(key),
        reload: () => reload(key, args),
        isSettled: () => isSettled(key),
        isFresh: () => isFresh(key),
      };
    };
    const cachedFn: CachedFunction<T, U, S> = Object.assign(withArgs(call), {
      get: withArgs(get),
      delete: withArgs(delete_),
      reload: withArgs(reload),
      isSettled: withArgs(isSettled),
      isFresh: withArgs(isFresh),
      context: withArgs(getContext),
      clear,
      cache,
    });
    return cachedFn;
  };
  return asyncMemo;
}

export const asyncMemo = createAsyncMemo();
