import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

// 仅供局域网 Lab 接收模拟测试报告，不接受客户端指定文件路径。
export function reportReceiver(directory){
 const token=randomBytes(24).toString('hex');let queue=Promise.resolve();
 return async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  if(!['/lab-report-session','/lab-report'].includes(path))return false;
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(path==='/lab-report-session'&&req.method==='GET'){res.end(JSON.stringify({token}));return true;}
  if(req.method!=='POST'||req.headers['x-lab-token']!==token||req.headers.origin!==`http://${req.headers.host}`){res.writeHead(403).end('{}');return true;}
  try{
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024){res.writeHead(413).end('{}');return true;}chunks.push(chunk);}
   const report=JSON.parse(Buffer.concat(chunks).toString('utf8')),s=report.session;
   if(!s||!/^[a-zA-Z0-9-]{8,80}$/.test(s.id)||!Number.isSafeInteger(s.revision)||s.revision<1||!Array.isArray(report.automatic?.results))throw Error('无效报告');
   const name=`material-lab-${s.id}.json`,file=join(directory,name);
   const save=queue.then(async()=>{
    await mkdir(directory,{recursive:true});
    let old;try{old=JSON.parse(await readFile(file,'utf8'));if(old.session.revision>s.revision)return;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(report.transport){const {start,total}=report.transport,existing=old?.automatic.results||[];
     if(!Number.isSafeInteger(start)||!Number.isSafeInteger(total)||start<0||total<start||start>existing.length||start+report.automatic.results.length>total)throw Error('检查点顺序无效');
     const merged=existing.slice();report.automatic.results.forEach((r,i)=>{merged[start+i]=r;});report.automatic.results=merged;
     report.transport.received=merged.length;if(merged.length<total)report.session={...s,status:'receiving'};
    }
    const temp=join(directory,`${s.id}-${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temp,JSON.stringify(report),{flag:'wx'});await rename(temp,file);
   });queue=save.catch(()=>{});await save;
   res.end(JSON.stringify({saved:true,file:name,revision:s.revision}));
  }catch{if(!res.headersSent)res.writeHead(400);res.end('{}');}
  return true;
 };
}
