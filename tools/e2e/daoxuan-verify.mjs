import { readFileSync } from 'node:fs';
import { openPage, apiLogin, api, assert } from './cdp.mjs';
const base='https://127.0.0.1:5173', endpoint='http://127.0.0.1:3000/api/v1';
const fixture=JSON.parse(readFileSync('_backups/profile-verification/fixture.json','utf8'));
const cookie=await apiLogin(endpoint,fixture.username,fixture.password);
const me=async()=>(await api(endpoint,'/auth/me',{cookie})).data.user;
const original=(await me()).avatarId;
const page=await openPage(9236);
try {
  await page.send('Security.setIgnoreCertificateErrors',{ignore:true});
  await page.setCookie('libellum_session',cookie);await page.setViewport(390,844,true);
  if(original==='daoxuan-special')await api(endpoint,'/auth/profile',{cookie,method:'PATCH',body:{field:'avatarId',value:'flower',previousValue:original}});
  const before=(await me()).avatarId;
  await page.navigate(base+'/profile/avatar');
  await page.waitFor(`!!document.querySelector('button[aria-label="倒悬"]')`);
  assert(await page.evaluate(`document.querySelector('[role=group][aria-label="基础系列"]').querySelectorAll('button').length===7 && document.querySelector('[role=group][aria-label="特典系列"]').querySelectorAll('button').length===1`),'系列分组错误');
  assert(await page.evaluate(`[...document.querySelectorAll('[aria-pressed]')].every(b=>b.textContent.trim()==='')`),'网格仍显示名称');
  await page.evaluate(`document.querySelector('button[aria-label="初绽"]').click()`);
  assert(await page.evaluate(`document.querySelector('[aria-label="头像预览"]').innerText.includes('初绽') && document.querySelector('[aria-label="头像预览"]').innerText.includes('基础系列 · 默认')`),'初绽默认信息缺失');
  await page.evaluate(`document.querySelector('button[aria-label="倒悬"]').click()`);
  assert(await page.evaluate(`document.querySelector('[aria-label="头像预览"]').innerText.includes('倒悬') && document.querySelector('[aria-label="头像预览"]').innerText.includes('特典系列')`),'预览名称与系列未切换');
  assert((await me()).avatarId===before,'预览写入了账户');
  assert(await page.evaluate(`document.querySelector('section svg').dataset.avatarId==='daoxuan-special'`),'预览未接线');
  const check=await page.evaluate(`(() => {const svg=document.querySelector('section svg');const ids=[...document.querySelectorAll('mask')].map(x=>x.id);return {white:getComputedStyle(svg).color==='rgb(255, 255, 255)',unique:ids.length===new Set(ids).size,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
  assert(check.white&&check.unique&&!check.overflow,'白图/蒙版/布局异常');
  await page.screenshot('_backups/profile-verification/12-avatar-series.png');
  for(const width of [320,768]){
    await page.setViewport(width,844,width<500);
    assert(await page.evaluate(`document.documentElement.scrollWidth<=innerWidth`),'响应式溢出');
  }
  await page.setViewport(390,844,true);
  await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存').click()`);
  await page.waitFor(`location.pathname==='/profile'`);
  assert((await me()).avatarId==='daoxuan-special','保存失败');
  await page.navigate(base+'/profile/avatar');
  await page.waitFor(`document.querySelector('button[aria-label="倒悬"]')?.getAttribute('aria-pressed')==='true'`);
  await page.navigate(base+'/me');
  await page.waitFor(`!!document.querySelector('[data-avatar-id="daoxuan-special"]')`);
  console.log('通过：特典上架、预览不写入、白图深底、蒙版隔离、保存、重开选中、我的页面显示。');
} finally {
  const current=(await me()).avatarId;
  if(current!==original)await api(endpoint,'/auth/profile',{cookie,method:'PATCH',body:{field:'avatarId',value:original,previousValue:current}});
  page.close();
}
