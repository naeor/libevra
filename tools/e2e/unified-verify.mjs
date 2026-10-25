/** 合并后的 localhost 冒烟；只使用隔离的资料验收账号，不接外部服务。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { openPage, apiLogin, api, assert } from './cdp.mjs';
const base='https://127.0.0.1:5173',endpoint='http://127.0.0.1:3000/api/v1';
const dir='_backups/integration/verification';mkdirSync(dir,{recursive:true});
const f=JSON.parse(readFileSync('_backups/profile-verification/fixture.json','utf8'));
const cookie=await apiLogin(endpoint,f.username,f.password);
const me=async()=>(await api(endpoint,'/auth/me',{cookie})).data.user;
const original=await me(),p=await openPage(9236),results=[];
const click=async(label)=>{
  const expr=`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)})`;
  await p.waitFor(`!!(${expr})`);await p.evaluate(`(${expr}).click()`);
};
const show=async(path,selector)=>{await p.navigate(base+path);await p.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);};
let prefs;
try{
 await p.send('Security.setIgnoreCertificateErrors',{ignore:true});await p.setCookie('libellum_session',cookie);await p.setViewport(390,844,true);
 await show('/settings/appearance/language','[data-language-option]');
 prefs=await p.evaluate(`({language:localStorage.getItem('libevra.language'),theme:localStorage.getItem('libevra.theme')})`);
 for(const locale of ['zh-CN','en-US']){
  await show('/settings/appearance/language','[data-language-option]');
  await p.evaluate(`document.querySelector('[data-language-option="${locale}"]').click()`);
  await p.waitFor(`document.documentElement.lang===${JSON.stringify(locale)}`);
  await show('/profile?edit=1','button[aria-label]');
  await click(locale==='zh-CN'?'轻点头像更换':'Tap to change avatar');
  await p.waitFor(`location.pathname==='/profile/avatar' && document.querySelectorAll('[aria-pressed]').length===9`);
  const goal=locale==='zh-CN'?'daoxuan-special':'flower',label=locale==='zh-CN'?'倒悬':'First Bloom';
  const before=await me();await click(label);
  assert((await me()).avatarId===before.avatarId,'预览写入账户');
  assert(await p.evaluate(`document.querySelector('section svg').dataset.avatarId===${JSON.stringify(goal)}`),'头像预览未接线');
  assert(await p.evaluate(`[...document.querySelectorAll('[aria-pressed]')].every(b=>b.textContent.trim()==='')`),'网格名称未收起');
  assert(await p.evaluate(`!!document.querySelector('[role=group][aria-label="${locale==='zh-CN'?'特典系列':'Special collection'}"]')`),'系列文案未切换');
  for(const width of [320,390,768]){await p.setViewport(width,844,width<500);assert(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'),'头像页溢出');}
  await p.setViewport(390,844,true);await p.screenshot(`${dir}/avatars-${locale}.png`);
  if(before.avatarId!==goal){await click(locale==='zh-CN'?'保存':'Save');await p.waitFor(`location.pathname==='/profile'`);}
  assert((await me()).avatarId===goal,'保存失败');
  await show('/profile/avatar','[aria-pressed=true]');assert(await p.evaluate(`document.querySelector('[aria-pressed=true] svg').dataset.avatarId===${JSON.stringify(goal)}`),'重新打开选择丢失');
  await show('/me','header svg[data-avatar-id]');
  assert(await p.evaluate(`getComputedStyle(document.querySelector('header svg[data-avatar-id]')).boxShadow.includes('4px')`),'头像白圈丢失');
  await p.screenshot(`${dir}/me-${locale}.png`);
  assert((await me()).displayName===original.displayName && (await me()).username===original.username,'语言/头像改变身份数据');
  results.push({locale,profileEntry:true,avatarPreviewAndSave:true,reopen:true,series:true,whiteRing:true,noOverflow:[320,390,768]});
 }
 await show('/settings/appearance/theme','[data-theme-palette]');
 const colors=[];
 for(const mode of ['light','dark']){
  await click(mode==='light'?'Light':'Dark');
  for(const palette of ['green','yellow','orange','blue','purple','red','cyan']){
   await p.evaluate(`document.querySelector('button span[data-theme-palette="${palette}"]').closest('button').click()`);
   await p.waitFor(`document.documentElement.dataset.themePalette==='${palette}' && document.documentElement.dataset.themeMode==='${mode}'`);
   colors.push({mode,palette,brand:await p.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim()`)});
  }
 }
 assert(new Set(colors.map(c=>c.brand)).size>=7,'主题色未变化');
 await show('/settings/appearance/theme','[data-theme-palette]');
 assert(await p.evaluate(`document.documentElement.dataset.themePalette==='cyan'&&document.documentElement.dataset.themeMode==='dark'`),'主题刷新未恢复');
 await p.screenshot(`${dir}/appearance-en-dark.png`);
 const health=await api(endpoint,'/health');assert(health.data.version==='1.16.09'&&health.data.database==='up','API版本或数据库异常');
 writeFileSync(`${dir}/results.json`,JSON.stringify({results,themeCombinations:colors,health:health.data},null,2));
 console.log('通过：中英真实切换、资料入口、八头像/系列、保存与重开、白圈、三宽度、14主题组合与刷新恢复、API1.16.09。');
}finally{
 const now=await me();if(now.avatarId!==original.avatarId)await api(endpoint,'/auth/profile',{cookie,method:'PATCH',body:{field:'avatarId',value:original.avatarId,previousValue:now.avatarId}});
 if(prefs)await p.evaluate(`(() => {const saved=${JSON.stringify(prefs)};for(const [name,value] of Object.entries(saved)){const key='libevra.'+name;if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}})()`);
 p.close();
}
