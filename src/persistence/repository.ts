import type { CabinetProfile, Id, Project, ProjectSummary } from "@/domain/model";

/** Storage boundary. IndexedDB implements it today; a cloud adapter can implement the same contract later. */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  /** Null if the project doesn't exist. Throws ProjectFormatError if it's unreadable. */
  load(id: Id): Promise<Project | null>;
  /**
   * Stores a project atomically. Pass the revision this copy was based on;
   * a different stored revision throws RevisionConflictError instead of overwriting.
   */
  save(project: Project, expectedRevision: number): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface CabinetLibrary {
  list(): Promise<CabinetProfile[]>;
  upsert(cabinet: CabinetProfile): Promise<void>;
}

export class RevisionConflictError extends Error {
  constructor(readonly storedRevision: number) {
    super("This project was changed in another tab or window. Reload to get the latest version; edits made here since the last save will be lost.");
    this.name = "RevisionConflictError";
  }
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.meta.name,
    client: project.meta.client,
    venue: project.meta.venue,
    updatedAt: project.meta.updatedAt,
    screenCount: project.physical.screens.length,
  };
}
