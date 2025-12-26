export interface IncrementalSyncUpdate<TLocal> {
  before: TLocal;
  after: TLocal;
}

export interface IncrementalSyncPlan<TLocal> {
  inserts: TLocal[];
  updates: Array<IncrementalSyncUpdate<TLocal>>;
  deletes: TLocal[];
  unchanged: TLocal[];
  skippedUserOverrides: TLocal[];
}

export interface IncrementalSyncOptions<TLocal, TRemote> {
  local: TLocal[];
  remote: TRemote[];
  getKey: (item: TLocal | TRemote) => string;
  areEqual: (local: TLocal, remote: TRemote) => boolean;
  merge: (local: TLocal | undefined, remote: TRemote) => TLocal;
  isUserOverride?: (local: TLocal) => boolean;
  allowDeletes?: boolean;
}

export function planIncrementalSync<TLocal, TRemote>(
  options: IncrementalSyncOptions<TLocal, TRemote>
): IncrementalSyncPlan<TLocal> {
  const isUserOverride = options.isUserOverride ?? (() => false);
  const allowDeletes = options.allowDeletes === true;

  const localByKey = new Map<string, TLocal>();
  for (const item of options.local) {
    localByKey.set(options.getKey(item), item);
  }

  const remoteByKey = new Map<string, TRemote>();
  for (const item of options.remote) {
    remoteByKey.set(options.getKey(item), item);
  }

  const inserts: TLocal[] = [];
  const updates: Array<IncrementalSyncUpdate<TLocal>> = [];
  const deletes: TLocal[] = [];
  const unchanged: TLocal[] = [];
  const skippedUserOverrides: TLocal[] = [];

  for (const remote of options.remote) {
    const key = options.getKey(remote);
    const local = localByKey.get(key);

    if (!local) {
      inserts.push(options.merge(undefined, remote));
      continue;
    }

    if (isUserOverride(local)) {
      skippedUserOverrides.push(local);
      continue;
    }

    if (options.areEqual(local, remote)) {
      unchanged.push(local);
      continue;
    }

    updates.push({
      before: local,
      after: options.merge(local, remote),
    });
  }

  if (allowDeletes) {
    for (const local of options.local) {
      const key = options.getKey(local);
      if (remoteByKey.has(key)) continue;

      if (isUserOverride(local)) {
        skippedUserOverrides.push(local);
        continue;
      }

      deletes.push(local);
    }
  }

  return { inserts, updates, deletes, unchanged, skippedUserOverrides };
}
