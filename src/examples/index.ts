import type { Project } from "@/domain/model";
import type { ExampleId } from "./catalog";
import { festivalMainStage } from "./festival";
import { corporateKeynote } from "./keynote";
import { motionLabProject } from "./motion-lab";
import { stress500 } from "./stress";

/** Builds an example project. Pure: the same id always gives the same project. Loaded on first use. */
export function buildExample(id: ExampleId): Project {
  switch (id) {
    case "festival":
      return festivalMainStage();
    case "keynote":
      return corporateKeynote();
    case "motion-lab":
      return motionLabProject().project;
    case "stress-500":
      return stress500();
  }
}
