import { getWindowInstanceId } from "./windowInstance";

interface StorageMeta {
  rev: number;
  updatedAt: number;
  updatedBy: string;
}

interface StorageEnvelope<T> {
  value: T;
  meta: StorageMeta;
}

function isStorageEnvelope<T>(input: unknown): input is StorageEnvelope<T> {
  if (!input || typeof input !== "object") return false;
  const candidate = input as Partial<StorageEnvelope<T>>;
  if (!candidate.meta || typeof candidate.meta !== "object") return false;
  const meta = candidate.meta as Partial<StorageMeta>;
  return typeof meta.rev === "number" && typeof meta.updatedAt === "number" && typeof meta.updatedBy === "string";
}

function defaultMeta(): StorageMeta {
  return {
    rev: 0,
    updatedAt: 0,
    updatedBy: "legacy",
  };
}

export function readVersionedStorage<T>(key: string, fallback: T): StorageEnvelope<T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { value: fallback, meta: defaultMeta() };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (isStorageEnvelope<T>(parsed)) {
      return parsed;
    }

    return {
      value: parsed as T,
      meta: defaultMeta(),
    };
  } catch {
    return { value: fallback, meta: defaultMeta() };
  }
}

export function writeVersionedStorage<T>(key: string, value: T, previousRev = 0): StorageEnvelope<T> {
  const current = readVersionedStorage<T>(key, value);
  const nextRev = Math.max(current.meta.rev, previousRev) + 1;
  const next: StorageEnvelope<T> = {
    value,
    meta: {
      rev: nextRev,
      updatedAt: Date.now(),
      updatedBy: getWindowInstanceId(),
    },
  };
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
