import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeRect, expandedRect, reliableTarget, surroundingPose, pushFrames, expansionFrames, boxFrame, EXPANSION_MIDDLE } from './geometry.mjs';

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
test('B2 后方完全不动，C 保留小幅避让', () => {
  const source = {y:200,height:78}, above = {y:110,height:78}, below = {y:290,height:78};
  assert.deepEqual(surroundingPose('b2',above,source,0), {transform:'none',opacity:1});
  assert.equal(surroundingPose('c',above,source,6).transform,'translate3d(0,-6px,0)');
  assert.equal(surroundingPose('c',below,source,6).transform,'translate3d(0,6px,0)');
});
for (const y of [30, 250, 500]) test(`B1 点击高度 ${y}：上下内容完整离屏，全程不碰撞`, () => {
  const source = { x: 24, y, width: 342, height: 78 }, viewport = { width: 390, height: 600 };
  const target = expandedRect(viewport.width, viewport.height);
  const above = { y: y - 88, height: 78 }, below = { y: y + 88, height: 78 };
  const up = pushFrames(above, source, viewport), down = pushFrames(below, source, viewport);
  const dy = frame => Number(frame.transform.match(/,([^p]+)px/)[1]);
  assert.ok(above.y + above.height + dy(up.at(-1)) <= 0);
  assert.ok(below.y + dy(down.at(-1)) >= viewport.height);
  assert.ok(up.every(frame => frame.opacity === 1));
  const middle = Object.fromEntries(Object.keys(source).map(key => [key, source[key] + (target[key] - source[key]) * EXPANSION_MIDDLE]));
  const shell = expansionFrames(boxFrame(source), boxFrame(middle), boxFrame(target));
  assert.deepEqual(up.map(({offset,easing}) => ({offset,easing})), shell.map(({offset,easing}) => ({offset,easing})));
  // 同一缓动下，区间内部仍是同一进度的插值；检查全程的非相交不等式。
  for (let p = 0; p <= 1; p += .01) {
    const top = source.y + (target.y - source.y) * p;
    const bottom = source.y + source.height + (target.y + target.height - source.y - source.height) * p;
    assert.ok(above.y + above.height + dy(up.at(-1)) * p <= top);
    assert.ok(below.y + dy(down.at(-1)) * p >= bottom);
  }
});
