import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {reportReceiver} from './report-receiver.mjs';
test('报告接收校验来源与路径，旧修订不能覆盖最新检查点',async()=>{
 const base=resolve('_backups/material-lab-test');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'receiver-'));
 const handler=reportReceiver(dir),server=createServer(async(req,res)=>{if(!await handler(req,res))res.writeHead(404).end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 try{const {token}=await(await fetch(url+'/lab-report-session')).json();const send=(id,revision,extra={})=>fetch(url+'/lab-report',{method:'POST',headers:{Origin:url,'X-Lab-Token':token,...extra},body:JSON.stringify({session:{id,revision},automatic:{results:[]}})});
 assert.equal((await send('test-run-123',1,{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await send('test-run-123',1,{'X-Lab-Token':'wrong'})).status,403);
 assert.equal((await send('../escape',1)).status,400);
 assert.equal((await send('test-run-123',2)).status,200);await send('test-run-123',1);
 assert.equal(JSON.parse(await readFile(join(dir,'material-lab-test-run-123.json'),'utf8')).session.revision,2);
 const delta=async(start,rows,revision)=>fetch(url+'/lab-report',{method:'POST',headers:{Origin:url,'X-Lab-Token':token},body:JSON.stringify({session:{id:'increment-test',revision,status:'complete'},automatic:{results:rows},transport:{start,total:3}})});
 assert.equal((await delta(2,[{id:2}],1)).status,400);
 await delta(0,[{id:0}],1);await delta(1,[{id:1}],1);await delta(1,[{id:1}],1);await delta(2,[{id:2}],1);await delta(3,[],2);
 const merged=JSON.parse(await readFile(join(dir,'material-lab-increment-test.json'),'utf8'));assert.deepEqual(merged.automatic.results.map(r=>r.id),[0,1,2]);assert.equal(merged.session.status,'complete');assert.equal(merged.transport.received,3);
 }finally{await new Promise(r=>server.close(r));}
});
