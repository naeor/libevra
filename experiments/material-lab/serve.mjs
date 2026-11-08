import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import {networkInterfaces} from 'node:os';
import {reportReceiver} from './report-receiver.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const port=Number(process.argv[2]||5191);
const receive=reportReceiver(resolve(root,'../../_backups/material-lab-reports'));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.md':'text/plain'};
createServer(async(req,res)=>{
 try{
  if(await receive(req,res))return;
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(path!==resolve(root)&&!path.startsWith(resolve(root)+sep)){res.writeHead(403).end();return;}
  const file=path===resolve(root)?resolve(root,'index.html'):path;
  const content=await readFile(file);
  res.writeHead(200,{'Content-Type':(mime[extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(content);
 }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
}).listen(port,'0.0.0.0',()=>{console.log(`Material Lab v0.4.0 · http://localhost:${port}/quick.html · 仅模拟数据`);for(const list of Object.values(networkInterfaces()))for(const a of list||[])if(a.family==='IPv4'&&!a.internal)console.log(`局域网候选地址：http://${a.address}:${port}/quick.html（手机须同网络，系统防火墙须允许本机服务）`);});
