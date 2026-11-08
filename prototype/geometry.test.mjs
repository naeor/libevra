import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeRect, expandedRect, reliableTarget, surroundingPose } from './geometry.mjs';

test('点击坐标相对于导航之间的舞台，保留真实位置', () => {
  assert.deepEqual(relativeRect({left:120,top:380,width:342,height:78},{left:96,top:180}), {x:24,y:200,width:342,height:78});
  assert.deepEqual(expandedRect(390,600), {x:8,y:8,width:374,height:584});
});
for (const y of [0, 200, 522]) test(`可见目标 ${y} 原位返回，不向中心钳制`, () => {
  const target = {x:24,y,width:342,height:78};
  assert.equal(reliableTarget(target,target,{width:390,height:600}), true);
});
test('不存在、边缘裁切、改序和视口变化安全降级', () => {
  const r = {x:24,y:200,width:342,height:78}, viewport = {width:390,height:600};
  for (const next of [null,{...r,y:-10},{...r,y:550},{...r,y:240},{...r,width:NaN}]) assert.equal(reliableTarget(r,next,viewport), false);
  assert.equal(reliableTarget(r,r,viewport,true), false);
  assert.equal(reliableTarget(r,r,{width:320,height:600}), false);
});
test('B2 后方完全不动；B1 / C 根据相对方向退让并限制幅度', () => {
  const source = {y:200,height:78}, above = {y:110,height:78}, below = {y:290,height:78};
  assert.deepEqual(surroundingPose('b2',above,source,0), {transform:'none',opacity:1});
  assert.match(surroundingPose('b1',above,source,24).transform, /,-2[01]\.\d+px/);
  assert.match(surroundingPose('b1',below,source,24).transform, /,2[01]\.\d+px/);
  assert.equal(surroundingPose('c',above,source,6).transform,'translate3d(0,-6px,0)');
  assert.equal(surroundingPose('c',below,source,6).transform,'translate3d(0,6px,0)');
});
