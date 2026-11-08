import test from 'node:test';
import assert from 'node:assert/strict';
import {Protection,Budget} from './protection.js';
import {blurSteps,blurPixels} from './core.js';
test('分批模糊与同步有限核逐像素一致',()=>{const src=Uint8ClampedArray.from({length:39*59*4},(_,i)=>i%255);for(const radius of [0,1,2,3]){const g=blurSteps(src,39,59,radius);let n,yields=0;do{n=g.next();yields++;}while(!n.done);assert.deepEqual(n.value,blurPixels(src,39,59,radius));if(radius)assert.ok(yields>10);}});
test('连续压力才降级，持续压力进入静态，稳定期逐级恢复',()=>{const p=new Protection();assert.equal(p.sample({p95:90},1000),false);assert.equal(p.sample({p95:90},2000),true);assert.equal(p.level,1);p.sample({p95:90},3000);p.sample({p95:90},4000);assert.equal(p.level,2);p.sample({p95:10},5000);p.sample({p95:10},16000);assert.equal(p.level,2);p.sample({p95:10},17000);assert.equal(p.level,1);p.sample({p95:10},18000);p.sample({p95:10},30000);assert.equal(p.level,0);});
test('输入压力也触发保护，关闭后不自动降级',()=>{const p=new Protection();p.sample({p95:8,input:200},1000);p.sample({p95:8,input:200},2000);assert.equal(p.level,1);p.enabled=false;p.sample({p95:200},3000);p.sample({p95:200},4000);assert.equal(p.level,1);});
test('分批任务暂停期间可取消，不运行后续工作',async()=>{const c=new AbortController(),b=new Budget(c.signal,{busy:()=>true,hidden:()=>false});setTimeout(()=>c.abort(),5);await assert.rejects(b.step(()=>assert.fail('不应执行')),e=>e.name==='AbortError');});
test('预算耗尽会让出事件循环',async()=>{const c=new AbortController(),b=new Budget(c.signal,{budgetMs:1,hidden:()=>false});b.sliceStart=performance.now()-10;let timer=false;setTimeout(()=>timer=true,0);await b.step(()=>{});assert.equal(timer,true);assert.equal(b.metrics.yields,1);});

test('预算内批量消费保持模糊结果，且支持中途取消',async()=>{const src=Uint8ClampedArray.from({length:39*59*4},(_,i)=>i%255),c=new AbortController(),b=new Budget(c.signal,{budgetMs:1,hidden:()=>false});assert.deepEqual(await b.consume(blurSteps(src,39,59,3)),blurPixels(src,39,59,3));const controller=new AbortController(),cancelled=new Budget(controller.signal,{budgetMs:1,hidden:()=>false});function* endless(){while(true)yield;}setTimeout(()=>controller.abort(),5);await assert.rejects(cancelled.consume(endless()),e=>e.name==='AbortError');});
