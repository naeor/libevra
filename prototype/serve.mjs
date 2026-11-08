import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
// 固定只读白名单：不暴露主项目目录、环境变量文件、数据库或依赖目录。
const referenceRoot = process.env.LIBEVRA_REFERENCE_ROOT || path.resolve(root, '../../记账程序v1');
const local = new Set(['index.html','style.css','app.mjs','geometry.mjs','motion.mjs']);
const references = {
  '/reference/tokens.css':'apps/web/src/s19/s19-lab-tokens.css',
  '/reference/material-components.css':'apps/web/src/s19/material-components.css',
  '/reference/material-effects.css':'apps/web/src/s19/material-effects.css',
  '/reference/b2.css':'apps/web/src/index.css',
};
// 验证所有只读引用均存在后才启动；旧 HEAD 不应悄悄冒充当前 S19 材质。
for (const file of Object.values(references)) await readFile(path.join(referenceRoot, file), 'utf8');
export function b2Tokens(source) {
  const selector = 'html:root[data-visual-style="b2"]';
  const start = source.indexOf(selector);
  if (start < 0) throw new Error('主工作区未找到正式 B2 令牌');
  const open = source.indexOf('{', start), end = source.indexOf('\n}', open);
  if (end < 0) throw new Error('B2 令牌块不完整');
  return source.slice(start, end + 2);
}
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  try {
    let body;
    if (Object.hasOwn(references, url.pathname)) {
      body = await readFile(path.join(referenceRoot, references[url.pathname]), 'utf8');
      if (url.pathname === '/reference/b2.css') body = b2Tokens(body);
    } else if (local.has(name)) body = await readFile(path.join(root, name), 'utf8');
    else { response.writeHead(404); response.end('Not found'); return; }
    response.writeHead(200, { 'Content-Type':name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
    response.end(request.method === 'HEAD' ? '' : body);
  } catch (error) { console.error(error.message); response.writeHead(500); response.end('本地只读材质引用不可用，请检查主工作区。'); }
});
const port = Number(process.env.LIBEVRA_PROTOTYPE_PORT || 5197);
server.on('error', error => { console.error(`原型未启动：${error.message}。不会占用其他端口或停止现有服务。`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Libevra S19-CT 0.2.0 · http://localhost:${port}\n只读材质来源：${referenceRoot}\nCtrl+C 停止此原型；不连接 API 或数据库。`));
