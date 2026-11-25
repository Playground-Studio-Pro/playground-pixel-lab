/** Fast map: paste a screen list, arrange it, fix it on the wall. Pure. The interface is in components/shell/fast-map. */
export * from "./parse";
export * from "./pack";
export * from "./arrange";
export * from "./wall";
export { swapOutputs, sameContent, applyScreenPlan, clearScreens } from "../project-ops";
