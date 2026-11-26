import type { Plan } from './types';

const DB_NAME = 'terrain-park-studio';
const DB_VERSION = 1;
const STORE = 'plans';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function idbSavePlan(plan: Plan): Promise<void> {
  const toSave: Plan = { ...plan, updatedAt: Date.now() };
  await tx('readwrite', (s) => s.put(toSave));
}

export async function idbGetPlan(id: string): Promise<Plan | undefined> {
  return tx<Plan | undefined>('readonly', (s) => s.get(id) as IDBRequest<Plan | undefined>);
}

export async function idbListPlans(): Promise<Plan[]> {
  const all = await tx<Plan[]>('readonly', (s) => s.getAll() as IDBRequest<Plan[]>);
  return (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function idbDeletePlan(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function idbCount(): Promise<number> {
  return tx<number>('readonly', (s) => s.count());
}
