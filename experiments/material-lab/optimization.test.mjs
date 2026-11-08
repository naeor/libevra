import test from 'node:test';
import assert from 'node:assert/strict';
import {blurPixels} from './core.js';
import {compactReport} from './report-storage.js';
// 0.3.2 索引方式作为冻结参考，验证优化不改变核与 Float32 舍入。
function previous(data,w,h,r){let a=new Float32Array(data);if(!r)return new Uint8ClampedArray(a);for(let pass=0;pass<3;pass++)for(const horizontal of [true,false]){const b=new Float32Array(a.length),len=horizontal?w:h,lines=horizontal?h:w,span=2*r+1;for(let line=0;line<lines;line++)for(let c=0;c<4;c++){const ix=n=>((horizontal?line*w+Math.min(len-1,Math.max(0,n)):Math.min(len-1,Math.max(0,n))*w+line)*4+c);let sum=0;for(let n=-r;n<=r;n++)sum+=a[ix(n)];for(let n=0;n<len;n++){b[ix(n)]=sum/span;sum+=a[ix(n+r+1)]-a[ix(n-r)];}}a=b;}return new Uint8ClampedArray(a);}
test('直接索引与旧实现逐像素一致，包括单像素与大半径',()=>{for(const [w,h] of [[1,1],[1,19],[23,1],[39,59]])for(const r of [0,1,3,12]){const src=Uint8ClampedArray.from({length:w*h*4},(_,i)=>(i*71+13)%256);assert.deepEqual(blurPixels(src,w,h,r),previous(src,w,h,r));}});
test('紧凑报告保留子阶段原始帧和统计，不修改在线数据',()=>{const frame={start:1,at:18,ms:17},r={automatic:{results:[{frames:{raw:[frame],truncated:false,stats:{p95:17}},phases:[{frames:{raw:[frame]}}]}]}};const c=compactReport(r);assert.deepEqual(c.automatic.results[0].phases[0].frames.raw,[[1,18,17]]);assert.equal(c.automatic.results[0].frames.raw,undefined);assert.equal(c.automatic.results[0].frames.stats.p95,17);assert.equal(r.automatic.results[0].frames.raw.length,1);});
