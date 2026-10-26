import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openPage, apiLogin, api, assert } from './cdp.mjs';

// 只访问专用回环候选服务与合成账号，夹具密码永不写入验收输出。
const base='http://127.0.0.1:5192',endpoint='http://127.0.0.1:3022/api/v1';
const out=resolve('_backups/avatars02');mkdirSync(out,{recursive:true});
const fixture=JSON.parse(readFileSync(process.env.LIBEVRA_AVATAR_FIXTURE??resolve(out,'fixture.json'),'utf8'));
const cases=[
 ['jade','玉净','甘露妙法，杨枝玉净。','Jade Vase'],
 ['ghost','幽幽','呜呜呜……别被吓到哦～','Boo'],
 ['ingot','元宝','摸摸元宝，招财进宝。','Ingot'],
 ['breakfast-sun','「太阳」','吃下一枚“太阳”，一整天都会更温暖。','「Sun」'],
];
const preview='section[aria-label="头像预览"],section[aria-label="Avatar preview"]';
const page=await openPage(9248,base),results=[];
let cookie=await apiLogin(endpoint,fixture.username,fixture.password);
const legal=await api(endpoint,'/legal/documents');
for(const doc of legal.data.documents){const accepted=await api(endpoint,'/account/agreements/accept',{method:'POST',cookie,body:{documentId:doc.id,documentVersion:doc.version,contentHash:doc.contentHash}});assert(accepted.status===200,'合成账号确认测试协议失败');}
function check(name,condition){assert(condition,name);results.push(name);console.log('PASS '+name);}
async function enter(){await page.navigate(base+'/profile/avatar');await page.waitFor(`!!document.querySelector(${JSON.stringify(preview)})`);}
async function select(id){await page.evaluate(`document.querySelector('#avatars-basic').closest('section').querySelector('button:has([data-avatar-id="${id}"])').click()`);await page.waitFor(`document.querySelector(${JSON.stringify(preview)}).querySelector('svg').dataset.avatarId===${JSON.stringify(id)}`);await page.evaluate('new Promise(resolve=>setTimeout(resolve,220))');}
async function read(){return page.evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(preview)});return {name:p.querySelector('h2').textContent,caption:p.querySelector('p.mt-2')?.textContent,text:p.innerText,overflow:document.documentElement.scrollWidth>innerWidth,basic:document.querySelector('#avatars-basic').closest('section').querySelectorAll('button').length,special:document.querySelector('#avatars-special').closest('section').querySelectorAll('button').length,svg:p.querySelector('svg').dataset.avatarId}})()`);}
try{
 await page.setCookie('libellum_session',cookie,base);
 await page.setViewport(390,1040,true);await enter();
 await page.evaluate("localStorage.setItem('libevra.language','zh-CN');localStorage.setItem('libevra.theme',JSON.stringify({mode:'light',palette:'green'}))");await enter();
 for(const[id,name,caption]of cases){
  await select(id);const p=await read();
  check(id+' 中文名称和题注准确',p.name===name&&p.caption===caption);
  check(id+' 经典默认可选且系列数量正确',p.basic===11&&p.special===2&&p.text.includes('经典系列')&&!p.text.includes('尚未解锁'));
  await page.screenshot(resolve(out,'picker-zh-'+id+'.png'));
  await page.evaluate("document.querySelector('div.sticky.bottom-0 button').click()");
  await page.waitFor("location.pathname==='/profile'");
  check(id+' 真实保存接口返回稳定 ID',(await api(endpoint,'/auth/me',{cookie})).data.user.avatarId===id);
  cookie=await apiLogin(endpoint,fixture.username,fixture.password);
  await page.setCookie('libellum_session',cookie,base);await enter();
  check(id+' 重新登录和重新载入后恢复',(await read()).svg===id);
 }
 await page.navigate(base+'/profile?edit=1');await page.waitFor("!!document.querySelector('[data-avatar-id=breakfast-sun]')");
 await page.screenshot(resolve(out,'profile-zh.png'));
 check('个人资料使用新头像组件',await page.evaluate("!!document.querySelector('[data-approved-art=breakfast-sun]')"));
 await page.navigate(base+'/ledger/members');await page.waitFor("!!document.querySelector('[data-avatar-id=ghost]')");
 check('协作成员使用各自的新头像',await page.evaluate("['jade','ghost','ingot','breakfast-sun'].every(id=>!!document.querySelector('[data-approved-art='+id+']'))"));
 await page.screenshot(resolve(out,'members-zh.png'));
 // 创建一条合成历史账目，确认更换头像不破坏既有账目/历史查询。
 const transaction=await api(endpoint,'/transactions',{method:'POST',cookie,bookId:fixture.bookId,body:{id:randomUUID(),idempotencyKey:randomUUID(),kind:'expense',amountCents:1200,currency:'CNY',occurredAt:'2026-10-26T07:00:00+08:00',occurredLocalDate:'2026-10-26',occurredTz:'Asia/Shanghai',note:'Avatar QA breakfast'}});
 check('既有账目接口正常',transaction.status===201);
 await page.navigate(base+'/ledger/history');await page.waitFor("document.body.innerText.includes('Avatar QA')");
 check('历史页面正常加载，无头像或脚本错误',await page.evaluate("!document.body.innerText.includes('出了点问题')"));
 await page.screenshot(resolve(out,'history-zh.png'));
 await enter();
 const combinations=[];
 for(const locale of['zh-CN','en-US'])for(const mode of['light','dark'])for(const palette of['green','yellow','orange','blue','purple','red','cyan']){
  await page.evaluate(`localStorage.setItem('libevra.language',${JSON.stringify(locale)});localStorage.setItem('libevra.theme',${JSON.stringify(JSON.stringify({mode,palette}))})`);await enter();
  for(const[id,name,caption,enName]of cases){await select(id);const p=await read();assert(p.name===(locale==='zh-CN'?name:enName)&&!p.overflow,'组合文字或溢出：'+[locale,mode,palette,id].join('/'));}
  const actual=await page.evaluate("({mode:document.documentElement.dataset.themeMode,palette:document.documentElement.dataset.themePalette})");
  assert(actual.mode===mode&&actual.palette===palette,'主题属性不符');combinations.push({locale,mode,palette});
  if(palette==='green'&&locale==='en-US')await page.screenshot(resolve(out,'picker-en-'+mode+'.png'));
  if(palette==='green'&&mode==='dark'&&locale==='zh-CN')await page.screenshot(resolve(out,'picker-zh-dark.png'));
 }
 check('七主题 × 浅深 × 双语的四款预览全部通过',combinations.length===28);
 const layouts=[];
 for(const width of[320,390,430,1120]){await page.setViewport(width,1040,width<500);for(const[id]of cases){await select(id);assert(!(await read()).overflow,'窄屏溢出');}layouts.push(width);}
 check('320/390/430/1120 宽度无文字横向溢出',layouts.length===4);
 // 用真实 UserAvatar 图形克隆验证四种宽度；临时测试节点在截图前移除。
 const sizes=await page.evaluate(`(()=>{const result=[];for(const id of ['jade','ghost','ingot','breakfast-sun']){const source=document.querySelector('#avatars-basic').closest('section').querySelector('svg[data-avatar-id='+id+']');for(const size of[24,32,40,48]){const copy=source.cloneNode(true);copy.setAttribute('class','');copy.style.width=size+'px';copy.style.height=size+'px';document.body.append(copy);const b=copy.getBoundingClientRect(),art=copy.querySelector('[data-approved-art]').getBBox();result.push({id,size,width:b.width,height:b.height,withinViewBox:art.x>=0&&art.y>=0&&art.x+art.width<=96&&art.y+art.height<=96});copy.remove();}}return result})()`);
 check('四款在24/32/40/48实际宽高正确且图形在viewBox内',sizes.length===16&&sizes.every(s=>s.width===s.size&&s.height===s.size&&s.withinViewBox));
 await page.setViewport(390,1040,true);await page.evaluate("localStorage.setItem('libevra.language','zh-CN');localStorage.setItem('libevra.theme',JSON.stringify({mode:'light',palette:'green'}))");await enter();
 // 保留已保存的「太阳」作为用户可直接打开的候选入口。
 await select('breakfast-sun');
 writeFileSync(resolve(out,'e2e-results.json'),JSON.stringify({checks:results,combinations,layouts,sizes,scope:'真实前端 + 真实 API + 专用本机数据库 + 合成账号'},null,2));
 console.log('验收完成：'+results.length+'项，112个头像/语言/主题组合。');
}finally{page.close();}
