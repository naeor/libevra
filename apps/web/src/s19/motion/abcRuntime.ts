import { registerABCPresentation } from "./abcBridge.js";
import { ABCPagePresentation } from "./abcPresentation.js";
import { captureATabs, startATabs, syncATabs } from "./aTabs.js";
import "./abc.css";
import "./aTabs.css";

/** 仅 lab.ts 加载；没有第二套导航、历史或实验账目。 */
export function startABCRuntime(): void {
  registerABCPresentation(() => new ABCPagePresentation(syncATabs), captureATabs);
  startATabs();
}
