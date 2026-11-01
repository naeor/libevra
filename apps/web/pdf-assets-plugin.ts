import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/** PDF 字体和解码资源随本站发布，不从第三方 CDN 读取用户文档。 */
export function pdfAssetsPlugin(): Plugin {
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const assets = new Map<string, string>();
  for (const folder of ["cmaps", "standard_fonts", "wasm"]) {
    for (const name of readdirSync(path.join(root, folder))) {
      if (/\.(bcmap|pfb|ttf|wasm|js)$/.test(name) || name.startsWith("LICENSE")) assets.set(`${folder}/${name}`, path.join(root, folder, name));
    }
  }
  return {
    name: "libevra-pdf-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs-assets", (request, response, next) => {
        const file = assets.get((request.url ?? "").split("?")[0]!.replace(/^\//, ""));
        if (!file) return next();
        response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of assets) this.emitFile({ type: "asset", fileName: `pdfjs-assets/${name}`, source: readFileSync(file) });
    },
  };
}
