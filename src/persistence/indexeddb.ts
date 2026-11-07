import type { CabinetProfile, Project, ProjectSummary } from "@/domain/model";
import { RevisionConflictError, summarize, type CabinetLibrary, type ProjectRepository } from "./repository";
import { ProjectFormatError, parseCabinet, parseProject } from "./schema";

const DB_NAME = "playground-pixel-lab";
const DB_VERSION = 1;
const PROJECTS = "projects";
const CABINETS = "cabinets";

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
    tx.onabort = () => reject(tx.error ?? new Error("The save was cancelled by the browser."));
  });
}

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CABINETS)) db.createObjectStore(CABINETS, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbProjectRepository implements ProjectRepository {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<ProjectSummary[]> {
    const tx = this.db.transaction(PROJECTS, "readonly");
    const all = await request<Project[]>(tx.objectStore(PROJECTS).getAll());
    // Unreadable records stay in storage and are simply not listed, so they are never destroyed.
    const summaries = all.flatMap((raw) => {
      try {
        return [summarize(parseProject(raw))];
      } catch (error) {
        if (error instanceof ProjectFormatError) return [];
        throw error;
      }
    });
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<Project | null> {
    const tx = this.db.transaction(PROJECTS, "readonly");
    const raw = await request<unknown>(tx.objectStore(PROJECTS).get(id));
    return raw === undefined ? null : parseProject(raw);
  }

  /** Read-then-write happens inside one transaction, so the revision check can't race another tab. */
  save(project: Project, expectedRevision: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(PROJECTS, "readwrite");
      const store = tx.objectStore(PROJECTS);
      let conflict: RevisionConflictError | null = null;
      const read = store.get(project.id);
      read.onsuccess = () => {
        const existing = read.result as Project | undefined;
        if (existing && existing.meta.revision !== expectedRevision) {
          conflict = new RevisionConflictError(existing.meta.revision);
          tx.abort();
          return;
        }
        store.put(project);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(conflict ?? tx.error);
      tx.onabort = () => reject(conflict ?? tx.error ?? new Error("The browser cancelled the save. Check available storage and try again."));
    });
  }

  async delete(id: string): Promise<void> {
    const tx = this.db.transaction(PROJECTS, "readwrite");
    tx.objectStore(PROJECTS).delete(id);
    await done(tx);
  }
}

export class IndexedDbCabinetLibrary implements CabinetLibrary {
  constructor(private readonly db: IDBDatabase) {}

  async list(): Promise<CabinetProfile[]> {
    const tx = this.db.transaction(CABINETS, "readonly");
    const all = await request<unknown[]>(tx.objectStore(CABINETS).getAll());
    return all.map(parseCabinet).sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsert(cabinet: CabinetProfile): Promise<void> {
    const tx = this.db.transaction(CABINETS, "readwrite");
    tx.objectStore(CABINETS).put(cabinet);
    await done(tx);
  }
}
