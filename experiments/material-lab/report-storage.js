// 检查点只在计时轮次之外持久化，避免将网络 / IndexedDB 耗时算入算法。
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('lmpp-reports',1);r.onupgradeneeded=()=>r.result.createObjectStore('reports');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function localReport(value){const db=await database();try{return await new Promise((resolve,reject)=>{const t=db.transaction('reports',value?'readwrite':'readonly'),s=t.objectStore('reports'),r=value?s.put(value,'latest'):s.get('latest');t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('本地保存中断'));});}finally{db.close();}}
const acknowledged=new Map();
export function compactReport(report){const data=structuredClone(report);data.format='lmpp-compact-1';for(const round of data.automatic.results){delete round.frames.raw;round.frames.rawSource='phases[].frames.raw [start, at, ms]';for(const p of round.phases)p.frames.raw=p.frames.raw.map(f=>[f.start,f.at,f.ms]);}return data;}
export async function sendReport(report,timeoutMs=30000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const session=await fetch('/lab-report-session',{signal:controller.signal});if(!session.ok)throw Error('电脑未提供报告接收服务');const {token}=await session.json();
 const all=report.automatic.results,total=all.length;let start=acknowledged.get(report.session.id)||0,receipt;
 do{const end=Math.min(total,start+1),payload={...report,automatic:{...report.automatic,results:all.slice(start,end)},transport:{start,total}};
 const r=await fetch('/lab-report',{method:'POST',headers:{'Content-Type':'application/json','X-Lab-Token':token},body:JSON.stringify(payload),signal:controller.signal});if(!r.ok)throw Error(`电脑保存失败 (${r.status})`);receipt=await r.json();start=end;acknowledged.set(report.session.id,start);
 }while(start<total);return receipt;
 }finally{clearTimeout(timer);}}
