import * as FS from 'fs-extra';

interface CacheEntry {
  value: any;
  expires?: number;
}

interface Dict<T> {
  [key: string]: T;
}

export class BoringCache {
  private data: Dict<CacheEntry | CacheEntry[]>;

  private writeDebounceTimer: NodeJS.Timer | undefined;

  constructor(readonly path: string) {
    if (FS.existsSync(path)) {
      let json = FS.readFileSync(path, 'utf-8');
      this.data = JSON.parse(json);
    } else {
      this.data = {};
      this.scheduleWrite();
    }

    process.on('exit', () => {
      if (this.writeDebounceTimer) {
        this.save();
      }
    });
  }

  get<T = any>(key: string): T | undefined {
    let entry = this.data[key];

    if (Array.isArray(entry)) {
      return undefined;
    }

    return entry && (!entry.expires || entry.expires > Date.now())
      ? entry.value
      : undefined;
  }

  set<T = any>(key: string, value: T, ttl = Infinity): void {
    this.data[key] = {
      value,
      expires: ttl === Infinity ? undefined : Date.now() + ttl,
    };

    this.scheduleWrite();
  }

  list<T = any>(key: string): T[] {
    let items = this.data[key];

    if (!Array.isArray(items)) {
      return [];
    }

    let now = Date.now();

    return items
      .filter(item => !item.expires || item.expires > now)
      .map(item => item.value);
  }

  push<T = any>(key: string, value: T, ttl = Infinity): void {
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

  pull<T = any>(key: string, value: T | ((value: T) => boolean)): void {
    let items = this.data[key];

    if (!Array.isArray(items)) {
      return;
    }

    let filter =
      typeof value === 'function'
        ? value
        : (comparingValue: T) => comparingValue === value;

    this.data[key] = items.filter(({value}) => filter(value));

    this.scheduleWrite();
  }

  delete(key: string): void {
    delete this.data[key];
    this.scheduleWrite();
  }

  clear(): void {
    this.data = {};
    this.scheduleWrite();
  }

  save(): void {
    clearImmediate(this.writeDebounceTimer);

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

  private scheduleWrite(): void {
    if (this.writeDebounceTimer) {
      return;
    }

    this.writeDebounceTimer = setImmediate(() => this.save());
  }
}
