import { z } from "zod";
import { SEED_LIBRARY_CABINETS, type LibraryCabinet } from "@/domain/cabinets";
import type { Id } from "@/domain/model";
import { openDatabase } from "./indexeddb";
import { parseCabinet } from "./schema";

/**
 * The cabinet library: profiles kept per browser, outside any project.
 *
 * It has its own IndexedDB database, so it never shares a version number or an
 * upgrade with project storage. Projects keep copies of the profiles they use,
 * so editing or deleting a library profile never changes a saved project.
 */
export interface CabinetLibraryRepository {
  /** Every readable profile, sorted by name. Unreadable records stay stored and are skipped. */
  list(): Promise<LibraryCabinet[]>;
  /** Null if there's no profile with this id. Throws CabinetFormatError if it's unreadable. */
  get(id: Id): Promise<LibraryCabinet | null>;
  /** Creates or replaces a profile. Throws CabinetFormatError, and stores nothing, if it's invalid. */
  save(entry: LibraryCabinet): Promise<void>;
  delete(id: Id): Promise<void>;
}

export class CabinetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CabinetFormatError";
  }
}

export const LIBRARY_DB_NAME = "playground-pixel-lab-cabinet-library";
const LIBRARY_DB_VERSION = 1;
const PROFILES = "profiles";
const META = "meta";
/** Set once the custom cabinets from the project database's old `cabinets` store were copied in. */
const LEGACY_IMPORTED = "legacy-cabinets-imported";
const LEGACY_STORE = "cabinets";

const libraryFields = z.object({
  source: z.literal("custom"),
  supplier: z.string().trim().max(120).default(""),
  model: z.string().trim().max(120).default(""),
  datasheetNote: z.string().trim().max(2000).default(""),
});

/** Validates a library record. Profile fields pass the shared cabinet schema; supplier fields are library-only. */
export function parseLibraryCabinet(raw: unknown): LibraryCabinet {
  let profile;
  try {
    profile = parseCabinet(raw);
  } catch (error) {
    const issues = error instanceof z.ZodError ? error.issues : [];
    const details = issues.slice(0, 3).map((i) => `${i.path.join(".") || "cabinet"}: ${i.message}`).join("; ");
    throw new CabinetFormatError(`This isn't a valid cabinet profile${details ? ` (${details})` : ""}.`);
  }
  const extra = libraryFields.safeParse(raw);
  if (!extra.success) {
    const details = extra.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new CabinetFormatError(`This isn't a valid library cabinet (${details}).`);
  }
  return { ...profile, ...extra.data };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The browser cancelled the cabinet library change. Check available storage and try again."));
  });
}

/** Opens the library database. A brand-new library is seeded with SEED_LIBRARY_CABINETS, once. */
export function openCabinetLibraryDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROFILES)) {
        const profiles = db.createObjectStore(PROFILES, { keyPath: "id" });
        // Seeding inside the creating upgrade means a deleted seed never comes back.
        if (event.oldVersion === 0) for (const seed of SEED_LIBRARY_CABINETS) profiles.put(seed);
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbCabinetLibraryRepository implements CabinetLibraryRepository {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<LibraryCabinet[]> {
    const tx = this.db.transaction(PROFILES, "readonly");
    const all = await request<unknown[]>(tx.objectStore(PROFILES).getAll());
    const entries = all.flatMap((raw) => {
      try {
        return [parseLibraryCabinet(raw)];
      } catch (error) {
        if (error instanceof CabinetFormatError) return [];
        throw error;
      }
    });
    return entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async get(id: Id): Promise<LibraryCabinet | null> {
    const tx = this.db.transaction(PROFILES, "readonly");
    const raw = await request<unknown>(tx.objectStore(PROFILES).get(id));
    return raw === undefined ? null : parseLibraryCabinet(raw);
  }

  async save(entry: LibraryCabinet): Promise<void> {
    const valid = parseLibraryCabinet(entry);
    const tx = this.db.transaction(PROFILES, "readwrite");
    tx.objectStore(PROFILES).put(valid);
    await done(tx);
  }

  async delete(id: Id): Promise<void> {
    const tx = this.db.transaction(PROFILES, "readwrite");
    tx.objectStore(PROFILES).delete(id);
    await done(tx);
  }
}

/**
 * Copies custom cabinets saved before the library existed (the project database's
 * `cabinets` store) into the library, once. Existing library entries win; nothing is deleted.
 */
export async function importLegacyCabinets(libraryDb: IDBDatabase, projectDb: IDBDatabase): Promise<number> {
  const metaTx = libraryDb.transaction(META, "readonly");
  if ((await request(metaTx.objectStore(META).get(LEGACY_IMPORTED))) !== undefined) return 0;

  let legacy: unknown[] = [];
  if (projectDb.objectStoreNames.contains(LEGACY_STORE)) {
    const tx = projectDb.transaction(LEGACY_STORE, "readonly");
    legacy = await request<unknown[]>(tx.objectStore(LEGACY_STORE).getAll());
  }
  const candidates = legacy.flatMap((raw) => {
    try {
      const profile = parseCabinet(raw);
      return profile.source === "custom" ? [parseLibraryCabinet({ ...profile, supplier: "", model: "", datasheetNote: "" })] : [];
    } catch {
      return [];
    }
  });

  const tx = libraryDb.transaction([PROFILES, META], "readwrite");
  const profiles = tx.objectStore(PROFILES);
  let imported = 0;
  for (const entry of candidates) {
    const read = profiles.get(entry.id);
    read.onsuccess = () => {
      if (read.result === undefined) {
        profiles.put(entry);
        imported++;
      }
    };
  }
  tx.objectStore(META).put({ key: LEGACY_IMPORTED, value: true });
  await done(tx);
  return imported;
}

/** Opens the browser's cabinet library, importing older custom cabinets the first time. */
export async function openCabinetLibrary(factory: IDBFactory = indexedDB): Promise<CabinetLibraryRepository> {
  const db = await openCabinetLibraryDatabase(factory);
  try {
    const projectDb = await openDatabase(factory);
    try {
      await importLegacyCabinets(db, projectDb);
    } finally {
      projectDb.close();
    }
  } catch {
    // The import is a convenience. A failure leaves the old records where they are and the library usable.
  }
  return new IndexedDbCabinetLibraryRepository(db);
}
