import { registerABCPresentation } from "./abcBridge.js";
import { ABCPagePresentation } from "./abcPresentation.js";
import { captureATabs, startATabs, syncATabs } from "./aTabs.js";
import "./abc.css";
import "./aTabs.css";

/** 正式入口 product.ts 与开发入口 lab.ts 都会启动（重复调用无副作用）；没有第二套导航、历史或实验账目。 */
export function startABCRuntime(): void {
  registerABCPresentation(() => new ABCPagePresentation(syncATabs), captureATabs);
  startATabs();
}
