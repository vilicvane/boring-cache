import * as FS from 'fs-extra';
import {Dict, KeyOfValueContainingType} from 'tslang';

type __Element<T> = T extends any[] ? T[number] : never;

type ValuePredicate<T> = ((value: T) => boolean) | T;

interface CacheEntry {
  value: unknown;
  expires?: number;
}

export interface BoringCacheOptions<T extends object> {
  /** Initial data. */
  data?: T;
  /** Time to live in milliseconds, defaults to `Infinity`. */
  ttl?: number;
}

export class BoringCache<T extends object> {
  readonly ttl: number;

  private data: Dict<CacheEntry | CacheEntry[]>;

  private writeDebounceTimer: NodeJS.Immediate | undefined;

  constructor(path: string, options?: BoringCacheOptions<T>);
  constructor(
    readonly path: string,
    {data, ttl = Infinity}: BoringCacheOptions<object> = {},
  ) {
    this.ttl = ttl;

    if (FS.existsSync(path)) {
      let json = FS.readFileSync(path, 'utf-8');
      this.data = JSON.parse(json);
    } else {
      this.data = {};

      for (let [key, value] of Object.entries(data || {})) {
        this._set(key, value, ttl);
      }

      this.save();
    }

    process.on('exit', () => {
      if (this.writeDebounceTimer) {
        this.save();
      }
    });
  }

  get<TKey extends keyof T>(key: TKey): T[TKey];
  get(key: string): unknown {
    let entry = this.data[key];

    if (Array.isArray(entry)) {
      return undefined;
    }

    return entry && (!entry.expires || entry.expires > Date.now())
      ? entry.value
      : undefined;
  }

  set<TKey extends keyof T>(key: TKey, value: T[TKey], ttl?: number): void;
  set(key: string, value: unknown, ttl = Infinity): void {
    this._set(key, value, ttl);

    this.scheduleWrite();
  }

  list<TKey extends KeyOfValueContainingType<T, any[]>>(
    key: TKey,
  ): TKey extends keyof T ? Extract<T[TKey], any[]> : [];
  list(key: string): unknown {
    let items = this.data[key];

    if (!Array.isArray(items)) {
      return [];
    }

    let now = Date.now();

    return items
      .filter(item => !item.expires || item.expires > now)
      .map(item => item.value);
  }

  push<TKey extends KeyOfValueContainingType<T, any[]>>(
    key: TKey,
    value: TKey extends keyof T ? __Element<T[TKey]> : never,
    ttl?: number,
  ): void;
  push(key: string, value: unknown, ttl = Infinity): void {
    let items = this.data[key];

    this.data[key] = [
      ...(Array.isArray(items) ? items : []),
      {
        value,
        expires: ttl === Infinity ? undefined : Date.now() + ttl,
      },
    ];

    this.scheduleWrite();
  }

  pull<TKey extends KeyOfValueContainingType<T, any[]>>(
    key: TKey,
    value: ValuePredicate<TKey extends keyof T ? __Element<T[TKey]> : never>,
  ): void;
  pull(key: string, value: unknown): void {
    let items = this.data[key];

    if (!Array.isArray(items)) {
      return;
    }

    let matcher =
      typeof value === 'function'
        ? value
        : (comparingValue: T): boolean => comparingValue === value;

    this.data[key] = items.filter(({value}) => !matcher(value));

    this.scheduleWrite();
  }

  delete<TKey extends keyof T>(key: TKey): void;
  delete(key: string): void {
    delete this.data[key];
    this.scheduleWrite();
  }

  clear(): void {
    this.data = {};
    this.scheduleWrite();
  }

  save(): void {
    if (this.writeDebounceTimer) {
      clearImmediate(this.writeDebounceTimer);
    }

    this.writeDebounceTimer = undefined;

    let data = this.data;
    let now = Date.now();

    for (let key of Object.keys(data)) {
      let entry = data[key];

      if (Array.isArray(entry)) {
        entry = entry.filter(item => !item.expires || item.expires > now);

        if (entry.length) {
          data[key] = entry;
        } else {
          delete data[key];
        }
      } else {
        if (!entry || (entry.expires && entry.expires < now)) {
          delete data[key];
        }
      }
    }

    FS.outputJSONSync(this.path, data);
  }

  private _set(key: string, value: unknown, ttl: number): void {
    this.data[key] = {
      value,
      expires: ttl === Infinity ? undefined : Date.now() + ttl,
    };
  }

  private scheduleWrite(): void {
    if (this.writeDebounceTimer) {
      return;
    }

    this.writeDebounceTimer = setImmediate(() => this.save());
  }
}
