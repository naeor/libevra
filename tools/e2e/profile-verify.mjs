/** 真实 Chrome CDP + 本地 API 的交互验收；无远端请求。 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openPage, apiLogin, api, assert, runCase } from "./cdp.mjs";

const BASE = "https://127.0.0.1:5173";
const API = "http://127.0.0.1:3000/api/v1";
const dir = resolve("_backups/profile-verification");
mkdirSync(dir, { recursive: true });
const fixture = JSON.parse(readFileSync(`${dir}/fixture.json`, "utf8"));
const cookie = await apiLogin(API, fixture.username, fixture.password);
const page = await openPage(9236);
const results = [];
const me = async () => (await api(API, "/auth/me", { cookie })).data.user;
const click = async label => {
  await page.waitFor(`Array.from(document.querySelectorAll('button')).some(x=>x.getAttribute('aria-label')===${JSON.stringify(label)} || x.textContent.trim()===${JSON.stringify(label)})`);
  const found = await page.evaluate(`(() => {const e=[...document.querySelectorAll('button')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)} || x.textContent.trim()===${JSON.stringify(label)}); if(!e) return false; e.click(); return true;})()`);
  assert(found, `missing button ${label}`);
};
const screenshot = async name => { await new Promise(resolve => setTimeout(resolve, 220)); return page.screenshot(`${dir}/${name}.png`); };
const fill = value => page.evaluate(`(() => {const e=document.querySelector('form input'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const show = async path => { await page.navigate(BASE + path); await page.waitFor("!!document.querySelector('[data-avatar-id]')"); };
const noOverflow = () => page.evaluate("document.documentElement.scrollWidth<=innerWidth");
try {
  await page.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await page.setCookie("libellum_session", cookie);
  await page.setViewport(390, 844, true);
  await show("/profile");
  await page.waitFor("document.body.innerText.includes('林间小记')");
  await runCase(results, "展示模式只读且有真实编号与时间", async () => {
    assert(await page.evaluate("!document.querySelector('input') && !document.querySelector('button[aria-label=\"选择头像\"]') && !document.querySelector('button[aria-label=\"编辑昵称\"]')"), "editable fields in display");
    assert(await noOverflow(), "overflow"); await screenshot("01-profile-display");
  });
  await click("编辑");
  await runCase(results, "编辑模式与只读字段", async () => {
    assert(await page.evaluate("document.querySelectorAll('button[aria-label^=\"编辑\"]').length===2 && !!document.querySelector('dl.divide-y')"), "wrong editing rows");
    await screenshot("02-profile-edit");
  });
  await click("选择头像");
  await page.waitFor("location.pathname==='/profile/avatar'");
  await page.waitFor("document.querySelectorAll('[aria-pressed]').length===8");
  await runCase(results, "独立头像页默认状态", async () => {
    assert(await page.evaluate("document.querySelectorAll('[aria-pressed]').length===8 && document.querySelectorAll('[aria-pressed=true]').length===1"), "avatar list");
    await screenshot("03-avatar-default");
  });
  await runCase(results, "审核六款与默认小花上架，弦月双实例蒙版不冲突", async () => {
    const ids = await page.evaluate("Array.from(document.querySelectorAll('[aria-pressed] svg')).map(e=>e.dataset.avatarId)");
    assert(JSON.stringify(ids) === JSON.stringify(["flower", "sprout", "sun", "moon", "star", "wave", "coffee", "daoxuan-special"]), "wrong official set");
    await click("弦月");
    const masks = await page.evaluate("Array.from(document.querySelectorAll('mask')).map(e=>e.id)");
    assert(masks.length===6 && new Set(masks).size===6,"avatar mask collision");
    assert(await page.evaluate("Array.from(document.querySelectorAll('[data-approved-art=moon]')).every(e=>!!e.querySelector('circle[cx=\"46.5\"][cy=\"48\"][r=\"16.5\"]'))"), "approved tangent moon changed");
    const rings = await page.evaluate("document.querySelector('[data-approved-art=star]').querySelectorAll('circle').length");
    assert(rings===2,"star double rings lost");
    await screenshot("08-approved-moon");
  });
  await click("海浪");
  await runCase(results, "选择立即预览，不改后端与其他页面", async () => {
    assert((await me()).avatarId === "flower", "preview wrote account");
    assert(await page.evaluate("document.querySelector('section svg').dataset.avatarId==='wave' && document.querySelector('[aria-label=\"海浪\"]').getAttribute('aria-pressed')==='true'"), "preview missing");
    assert(await noOverflow(), "overflow"); await screenshot("04-avatar-preview");
  });
  await runCase(results, "头像保存失败保留预览且不重复提交", async () => {
    let count = 0;
    const paused = async event => {
      const msg = JSON.parse(event.data);
      if (msg.method !== "Fetch.requestPaused") return;
      count++;
      await page.send("Fetch.fulfillRequest", { requestId: msg.params.requestId, responseCode: 503, responseHeaders: [{ name: "content-type", value: "application/json" }], body: Buffer.from(JSON.stringify({ code: "test_unavailable", message: "验收模拟：暂时无法保存，请重试。" })).toString("base64") });
    };
    page.socket.addEventListener("message", paused);
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/auth/profile", requestStage: "Request" }] });
    await page.evaluate("(() => {const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='保存');b.click();b.click();})()");
    await page.waitFor("document.querySelector('[role=alert]')?.textContent.includes('验收模拟')");
    assert(count === 1 && (await me()).avatarId === "flower", "duplicate submit or failed save wrote data");
    assert(await page.evaluate("document.querySelector('section svg').dataset.avatarId==='wave'"), "failure lost preview");
    await page.send("Fetch.disable"); page.socket.removeEventListener("message", paused);
  });
  await runCase(results, "浏览器后退可取消且保留预览", async () => {
    await page.send("Page.enable");
    const dialog = async event => { if (JSON.parse(event.data).method === "Page.javascriptDialogOpening") await page.send("Page.handleJavaScriptDialog", { accept: false }); };
    page.socket.addEventListener("message", dialog);
    await page.evaluate("history.back()");
    await page.waitFor("location.pathname==='/profile/avatar' && history.state?.profileDraftGuard");
    assert(await page.evaluate("document.querySelector('section svg').dataset.avatarId==='wave'"), "browser back lost preview");
    page.socket.removeEventListener("message", dialog);
  });
  await runCase(results, "小屏 320px 网格与保存按钮", async () => {
    await page.setViewport(320, 640, true);
    assert(await noOverflow(), "320 overflow");
    const layout = await page.evaluate("(() => {const grid=document.querySelector('[role=group][aria-label=\"基础系列\"]');const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='保存');const r=b.getBoundingClientRect(); return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,bottom:r.bottom,top:r.top,height:innerHeight};})()");
    assert(layout.columns === 4 && layout.bottom <= layout.height && layout.top >= 0, JSON.stringify(layout));
    await screenshot("06-iphone-small"); return layout;
  });
  await runCase(results, "375/390/430/768/1440 宽度网格与溢出检查", async () => {
    const layouts = [];
    for (const width of [375, 390, 430, 768, 1440]) {
      await page.setViewport(width, 900, width < 768);
      const columns = await page.evaluate("getComputedStyle(document.querySelector('[role=group][aria-label=\"基础系列\"]')).gridTemplateColumns.split(' ').length");
      assert(await noOverflow(), `${width} overflow`);
      assert(columns === (width < 400 ? 4 : width < 768 ? 5 : 6), `${width} wrong columns ${columns}`);
      layouts.push({ width, columns });
    }
    return layouts;
  });
  await runCase(results, "临时深色背景和七强调色兼容（不是正式主题验收）", async () => {
    await click("弦月"); await click("海浪");
    const palettes = ["#80b598", "#dc8e8e", "#dbab76", "#d5c276", "#74bbc2", "#8baee4", "#b59bdb"];
    const checks = [];
    for (const brand of palettes) {
      await page.evaluate(`document.documentElement.style.setProperty('--color-brand',${JSON.stringify(brand)})`);
      checks.push(await page.evaluate("document.querySelector('section svg').dataset.avatarId==='wave' && getComputedStyle(document.querySelector('section svg')).color===getComputedStyle(document.querySelector('[aria-pressed=true] svg')).color"));
    }
    assert(checks.every(Boolean), "identity changed with palette");
    await page.setViewport(390, 844, true);
    await page.evaluate("(() => {const r=document.documentElement; for(const [k,v] of Object.entries({'canvas':'#192520','surface':'#24322b','ink':'#edf2e9','muted':'#adbbb0','line':'#40564a','brand':'#88b99a','brand-dark':'#b6d4be','brand-soft':'#2d4437'}))r.style.setProperty('--color-'+k,v); r.dataset.themeMode='dark'; const p=document.createElement('p');p.id='profile-simulated-theme';p.textContent='临时深色模拟 · 正式主题尚未实现';p.style.cssText='position:fixed;top:0;left:0;right:0;z-index:1000;background:#192520;color:#edf2e9;text-align:center;font-size:12px';document.body.append(p);})()");
    await new Promise(resolve => setTimeout(resolve, 250));
    await screenshot("05-avatar-dark-simulation");
    await page.evaluate("document.documentElement.removeAttribute('style');delete document.documentElement.dataset.themeMode;document.getElementById('profile-simulated-theme').remove()");
  });
  await click("返回");
  await click("放弃选择");
  await page.waitFor("location.pathname==='/profile'");
  await runCase(results, "取消不保存，再次打开仍是原头像", async () => {
    assert((await me()).avatarId === "flower", "cancel wrote account");
    await click("选择头像"); await page.waitFor("location.pathname==='/profile/avatar'");
    assert(await page.evaluate("document.querySelector('section svg').dataset.avatarId==='flower'"), "preview draft retained");
  });
  await click("海浪"); await click("保存");
  await page.waitFor("location.pathname==='/profile'");
  await runCase(results, "头像保存并刷新持久化", async () => {
    assert((await me()).avatarId === "wave", "avatar not saved");
    await show("/profile?edit=1");
    await page.waitFor("document.querySelector('section svg')?.dataset.avatarId==='wave'");
  });
  await runCase(results, "昵称未保存退出有确认且不写账户", async () => {
    await click("编辑昵称"); await fill("这段不应保存"); await click("完成");
    await click("继续编辑");
    assert(await page.evaluate("document.querySelector('form input').value==='这段不应保存'"), "cancel leave lost draft");
    await click("取消"); await click("放弃修改");
    assert((await me()).displayName === "林间小记", "discard wrote nickname");
  });
  await click("编辑昵称"); await fill("林间新昵称"); await click("保存");
  await page.waitFor("document.body.innerText.includes('资料已保存')");
  await runCase(results, "昵称真实保存", async () => { assert((await me()).displayName === "林间新昵称", "nickname not saved"); });
  await runCase(results, "用户名重名显示失败并保留输入", async () => {
    await click("编辑用户名"); await fill(`pb_${fixture.username.slice(3)}`); await click("保存");
    await page.waitFor("document.querySelector('[role=alert]')?.textContent.includes('被占用')");
    assert((await me()).username === fixture.username, "taken name replaced original");
    assert(await page.evaluate(`document.querySelector('form input').value===${JSON.stringify(`pb_${fixture.username.slice(3)}`)}`), "failure lost username draft");
  });
  await fill(`pn_${fixture.username.slice(3)}`); await click("保存");
  await page.waitFor("!document.querySelector('form')");
  await runCase(results, "用户名真实保存，ID 与编号不变", async () => {
    const user = await me(); assert(user.username === `pn_${fixture.username.slice(3)}` && user.id === fixture.id, "username not saved");
  });
  await runCase(results, "我的与共享成员按用户显示正式头像", async () => {
    await show("/me"); await page.waitFor("!!document.querySelector('[data-avatar-id=wave]')");
    const members = await api(API, "/books/members", { cookie, bookId: fixture.bookId });
    assert(members.data.members.find(x => x.userId === fixture.id).avatarId === "wave", "own avatar incorrect");
    assert(members.data.members.find(x => x.userId === fixture.otherId).avatarId === "moon", "other avatar incorrect");
    await show(`/start/book/${fixture.bookId}/members`);
    await page.waitFor("!!document.querySelector('[data-avatar-id=moon]')");
    assert(await page.evaluate("document.querySelectorAll('[data-avatar-id=wave]').length===1 && document.querySelectorAll('[data-avatar-id=moon]').length===1"), "member UI wrong avatars");
    await screenshot("07-shared-members");
  });
  await runCase(results, "协作预览与海浪入口使用正式头像", async () => {
    await show("/ledger");
    await page.waitFor("!!document.querySelector('[data-avatar-id=wave]') && !!document.querySelector('[data-avatar-id=moon]')");
    await show("/start");
    await page.waitFor("!!document.querySelector('.space-account [data-avatar-id=wave]')");
  });
  await runCase(results, "旧头像继续展示且可取消预览，切换正式头像后持久化", async () => {
    const seeded = await api(API,"/auth/profile",{method:"PATCH",cookie,body:{field:"avatarId",value:"cat",previousValue:"wave"}});
    assert(seeded.status===200,"legacy fixture failed");
    await show("/profile/avatar");
    await page.waitFor("document.querySelector('section svg')?.dataset.avatarId==='cat'");
    assert(await page.evaluate("document.querySelectorAll('[aria-pressed]').length===9 && document.querySelector('[aria-label=\"小猫\"]').getAttribute('aria-pressed')==='true'"),"legacy current option missing");
    await click("海浪"); assert((await me()).avatarId==="cat","preview changed legacy data");
    await click("小猫");
    assert(await page.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='保存').disabled"),"original selection should not submit");
    await click("海浪"); await click("保存");
    await page.waitFor("location.pathname==='/profile'");
    assert((await me()).avatarId==="wave","official save from legacy failed");
  });
} finally {
  writeFileSync(`${dir}/browser-results.json`, JSON.stringify(results, null, 2));
  await page.close();
}
if (results.some(r => r.status === "fail")) process.exitCode = 1;
