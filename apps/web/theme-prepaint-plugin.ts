import path from "node:path";
import { createHash } from "node:crypto";
import { build, type Plugin } from "vite";

/** 将同一套 TS 契约编成 head 同步脚本，早于 CSS/React，不另写解析器。 */
export function themePrepaintPlugin(): Plugin {
  let script: Promise<string> | null = null;
  let productionBuild = false;
  let base = "/";
  let assetPath = "";
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
    configResolved(config) {
      productionBuild = config.command === "build";
      base = config.base;
    },
    async buildStart() {
      if (!productionBuild) return;
      const source = await compile();
      const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
      assetPath = `assets/theme-prepaint-${hash}.js`;
      this.emitFile({ type: "asset", fileName: assetPath, source });
    },
    configureServer(server) {
      server.watcher.on("change", (file) => {
        if (["theme.ts", "theme-prepaint.ts", "visualStyle.ts", "wallpaper.ts"].includes(path.basename(file))) script = null;
      });
    },
    transformIndexHtml: { order: "post", async handler() {
      if (productionBuild) {
        return [{ tag: "script", attrs: { id: "libevra-theme-prepaint", src: base + assetPath }, injectTo: "head-prepend" }];
      }
      return [{ tag: "script", attrs: { id: "libevra-theme-prepaint" }, children: await compile(), injectTo: "head-prepend" }];
    } },
  };
}
