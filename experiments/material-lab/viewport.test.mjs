import test from 'node:test';import assert from 'node:assert/strict';import {tilePlan,rowContent} from './viewport-renderer.js';import {dataset} from './core.js';
const o={width:365,scale:.25,precision:1,theme:'light',blur:12};
test('可见区限定工作量；远处修改不影响当前区块',()=>{const rows=dataset(198411,240),a=tilePlan(rows,o,1200,500);assert.ok(a.length<=4);rows[200].amount++;assert.deepEqual(tilePlan(rows,o,1200,500),a);});
test('金额修改影响所在区块及 Halo；汇总头部另行失效',()=>{const rows=dataset(198411,80),a=tilePlan(rows,o,0,600);rows[0].amount++;const b=tilePlan(rows,o,0,600);assert.notEqual(a[0].key,b[0].key);assert.equal(a.at(-1).key,b.at(-1).key);});
test('元数据版本不改变绘制内容，位置不进入行内容键',()=>{const r=dataset(1,2)[0],k=rowContent(r);r.version++;assert.deepEqual(rowContent(r),k);assert.deepEqual(rowContent({...r}),k);});
