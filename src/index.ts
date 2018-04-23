import * as FS from 'fs-extra';

interface CacheEntry {
  value: any;
  expires?: number;
}

interface Dict<T> {
  [key: string]: T;
}

export class BoringCache {
  private data: Dict<CacheEntry>;

  private writeDebounceTimer: NodeJS.Timer | undefined;

  constructor(readonly path: string) {
    if (FS.existsSync(path)) {
      let json = FS.readFileSync(path, 'utf-8');
      this.data = JSON.parse(json);
    } else {
      this.data = {};
      this.scheduleWrite();
    }
  }

  get<T = any>(key: string): T | undefined {
    let entry = this.data[key];
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

      if (!entry || (entry.expires && entry.expires < now)) {
        delete data[key];
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
