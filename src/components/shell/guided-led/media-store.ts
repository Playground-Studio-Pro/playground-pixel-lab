/**
 * The drawing and the render of a guided project, kept on this computer only, in IndexedDB, keyed by project id. They
 * are not in the project file: how a project stores media isn't decided yet. Opening the project on another computer
 * shows the screens and answers, without the drawing.
 */

const DB_NAME = "playground-pixel-lab-guided-media";
const STORE = "media";

export type MediaSlot = "drawing" | "render";

export interface StoredMedia {
  readonly name: string;
  readonly type: string;
  readonly bytes: Blob;
  readonly savedAt: string;
}

function open(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const key = (projectId: string, slot: MediaSlot) => `${projectId}:${slot}`;

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>, factory?: IDBFactory): Promise<T> {
  const db = await open(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("The browser cancelled saving the drawing."));
    });
  } finally {
    db.close();
  }
}

export function saveMedia(projectId: string, slot: MediaSlot, media: StoredMedia, factory?: IDBFactory): Promise<unknown> {
  return run("readwrite", (s) => s.put(media, key(projectId, slot)), factory);
}

export async function loadMedia(projectId: string, slot: MediaSlot, factory?: IDBFactory): Promise<StoredMedia | null> {
  const value = await run<StoredMedia | undefined>("readonly", (s) => s.get(key(projectId, slot)) as IDBRequest<StoredMedia | undefined>, factory);
  return value ?? null;
}

