// 零依赖静态服务器：让同一局域网里的手机打开 Style Lab。
// 用法：node serve.mjs [端口]   （默认 5190，只读、只服务本目录）
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 5190);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".md": "text/plain; charset=utf-8", ".json": "application/json" };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (path.includes("..")) { res.writeHead(400).end(); return; }
    let file = join(root, path || "index.html");
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`\nLibevra S19 Style Lab 已启动（按 Ctrl+C 结束）`);
  console.log(`  本机：   http://localhost:${port}/`);
  for (const list of Object.values(networkInterfaces())) for (const n of list || []) if (n.family === "IPv4" && !n.internal) console.log(`  手机：   http://${n.address}:${port}/   （同一 Wi-Fi 下打开）`);
  console.log(`  单独方案：/a.html  /b.html  /c.html\n`);
});
