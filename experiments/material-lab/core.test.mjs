import test from 'node:test';
import assert from 'node:assert/strict';
import {dataset,stats,Cache,blurPixels,affectedTiles} from './core.js';
test('固定随机种子与不同场景',()=>{assert.deepEqual(dataset(23),dataset(23));assert.notDeepEqual(dataset(23),dataset(24));});
test('空数据不是零、分位数使用 nearest rank',()=>{assert.equal(stats([]).mean,null);assert.deepEqual(stats([1,2,3,4]),{n:4,mean:2.5,p50:2,p95:4,p99:4});});
test('LRU 字节预算、覆盖与计数',()=>{const c=new Cache(12);c.set('a',1,8);assert.equal(c.get('a'),1);c.set('b',2,8);assert.equal(c.get('a'),null);assert.equal(c.snapshot().bytes,8);assert.equal(c.snapshot().hits,1);c.set('b',3,4);assert.equal(c.bytes,4);c.clear();assert.equal(c.bytes,0);});
test('Halo 在不同核半径处与完整场景逐像素一致',()=>{const w=7,h=89,src=Uint8ClampedArray.from({length:w*h*4},(_,i)=>(i*71+13)%256);for(const r of [0,1,2,6]){const full=blurPixels(src,w,h,r),out=new Uint8ClampedArray(src.length),tile=13,halo=3*r;for(let y=0;y<h;y+=tile){const start=Math.max(0,y-halo),end=Math.min(h,y+tile+halo),part=blurPixels(src.slice(start*w*4,end*w*4),w,end-start,r);out.set(part.slice((y-start)*w*4,(Math.min(y+tile,h)-start)*w*4),y*w*4);}assert.deepEqual(out,full);}});
test('修改范围包含相邻 Halo，不更新无关区块',()=>{assert.deepEqual(affectedTiles(130,140,512,128,9),[0,128]);assert.deepEqual(affectedTiles(150,160,512,128,9),[128]);});
