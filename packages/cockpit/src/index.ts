export const MAESTRO_COCKPIT_VERSION = "0.0.0";

export type { CardVM, CockpitState, HostToWebview, WebviewToHost } from "./protocol.js";
export { initialModel, reduce, setFocus, OUTPUT_CAP } from "./reducer.js";
export type { CockpitModel } from "./reducer.js";
export { selectState } from "./select.js";
