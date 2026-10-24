import path from "node:path";
import { build, type Plugin } from "vite";

/** 将同一套 TS 契约编成 head 同步脚本，早于 CSS/React，不另写解析器。 */
export function themePrepaintPlugin(): Plugin {
  let script: Promise<string> | null = null;
  const compile = (): Promise<string> => script ??= (async () => {
    const result = await build({
      configFile: false, root: import.meta.dirname, logLevel: "silent",
      build: { write: false, target: "es2020", lib: { entry: path.resolve(import.meta.dirname, "src/theme-prepaint.ts"), formats: ["iife"], name: "LibevraThemePrepaint" } },
    });
    if (!("output" in result) && !Array.isArray(result)) throw new Error("首屏主题脚本未生成");
    const output = Array.isArray(result) ? result[0]! : result;
    if (!("output" in output)) throw new Error("首屏主题脚本未生成");
    const chunk = output.output.find(item => item.type === "chunk");
    if (!chunk || chunk.type !== "chunk") throw new Error("首屏主题脚本未生成");
    return chunk.code;
  })();
  return {
    name: "libevra-theme-prepaint",
    configureServer(server) { server.watcher.on("change", (file) => { if (file.endsWith("theme.ts") || file.endsWith("theme-prepaint.ts")) script = null; }); },
    transformIndexHtml: { order: "pre", async handler() {
      return [{ tag: "script", attrs: { id: "libevra-theme-prepaint" }, children: await compile(), injectTo: "head-prepend" }];
    } },
  };
}
