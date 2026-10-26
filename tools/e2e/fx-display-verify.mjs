import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { openPage, apiLogin, api, assert } from "./cdp.mjs";

const base = "http://127.0.0.2:5186", backend = "http://127.0.0.1:3016/api/v1";
const root = resolve(import.meta.dirname, "../.."), directory = resolve(root, "_backups/fx-d4/screenshots");
mkdirSync(directory, { recursive: true });
const config = JSON.parse(readFileSync(resolve(root, "_backups/fx-d4/preview.json"), "utf8"));
const page = await openPage(9246, base);
const results = [], failures = [];
const check = async (name, test) => {
  try { await test(); results.push({ name, ok: true }); console.log(`通过：${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); failures.push(name); console.log(`失败：${name}：${error.message}`); await page.screenshot(resolve(directory, "failure.png")); }
};
const shot = name => page.screenshot(resolve(directory, `${name}.png`));
const text = () => page.evaluate("document.body.innerText");
try {
  await page.setViewport(390, 844, true);
  let cookie = await apiLogin(backend, "fx_preview", config.password);
  await page.send("Network.setCookie", { name: "libellum_session", value: cookie, url: base, httpOnly: true, sameSite: "Lax" });
  await page.navigate(base + "/settings/appearance");
  await page.waitFor("!!document.querySelector('[role=switch]')", 20000);
  await page.evaluate(`import('/src/lib/currentBook.ts').then(m=>m.selectBookForReload(${JSON.stringify(config.bookId)}))`);
  await page.navigate(base + "/settings/appearance");
  await page.waitFor("!!document.querySelector('[role=switch]')");
  if (await page.evaluate("document.querySelector('[role=switch]').checked")) await page.evaluate("document.querySelector('[role=switch]').click()");
  const before = await api(backend, "/transactions", { cookie, bookId: config.bookId });
  await check("默认关闭、设置开关", async () => {
    await page.navigate(base + "/settings/appearance");
    await page.waitFor("!!document.querySelector('[role=switch]')", 20000);
    assert(!(await page.evaluate("document.querySelector('[role=switch]').checked")), "默认必须关闭"); await shot("01-setting-off");
  });
  await check("关闭时原列表无折算预设", async () => {
    await page.navigate(base + "/?month=2026-10");
    await page.waitFor("document.body.innerText.includes('汇率验收共享账本')", 20000);
    assert(!(await page.evaluate("!!document.querySelector('[data-fx-amount]')")), "关闭时不能出现折算信息"); await shot("02-detail-off");
  });
  await check("开启并显示折算及原币", async () => {
    await page.navigate(base + "/settings/appearance"); await page.waitFor("!!document.querySelector('[role=switch]')");
    await page.evaluate("document.querySelector('[role=switch]').click()"); await shot("03-setting-on");
    await page.navigate(base + "/?month=2026-10");
    await page.waitFor("document.body.innerText.includes('原币') && document.body.innerText.includes('133.40')", 30000);
    await shot("04-detail-on");
  });
  await check("账目详情依据，编辑仍为原币", async () => {
    const entry = config.transactions.find(row => row.currency === "USD" && row.occurredLocalDate.startsWith("2026"));
    await page.navigate(`${base}/transactions/${entry.id}`);
    await page.waitFor("document.body.innerText.includes('实际汇率日期：2026-10-23')");
    assert((await text()).includes("20.00 USD"), "应保留原币"); await shot("05-entry-rate");
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='修改').click()");
    assert(await page.evaluate("Array.from(document.querySelectorAll('input')).some(i=>Number(i.value)===20)"), "输入必须是原始20USD");
    await shot("06-edit-original");
  });
  await check("综合统计与逐笔显示一致", async () => {
    await page.navigate(base + "/stats");
    await page.waitFor("document.querySelector('[data-fx-stats]')?.innerText.includes('885.75')", 30000);
    const body = await text(); assert(body.includes("2,000.00 CNY") && body.includes("1,114.25 CNY"), "收入/差额应正确");
    await shot("07-stats-combined");
  });
  await check("历史缺项显示不完整且可定位", async () => {
    await page.evaluate("(()=>{const input=document.querySelector('input[type=month]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'1999-01');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await page.waitFor("document.body.innerText.includes('统计不完整')", 30000);
    assert((await text()).includes("1 笔账目未折算"), "早期CNY必须被排除"); await shot("08-stats-incomplete");
  });
  await check("关闭后恢复分币种分析", async () => {
    await page.navigate(base + "/settings/appearance"); await page.waitFor("!!document.querySelector('[role=switch]')");
    await page.evaluate("document.querySelector('[role=switch]').click()");
    await page.navigate(base + "/stats"); await page.waitFor("!document.querySelector('[data-fx-stats]') && document.body.innerText.includes('分析')");
    await shot("09-stats-off");
  });
  await check("离线已有历史汇率与综合结果一致", async () => {
    await page.navigate(base + "/settings/appearance"); await page.waitFor("!!document.querySelector('[role=switch]')");
    await page.evaluate("document.querySelector('[role=switch]').click()");
    await page.navigate(base + "/stats"); await page.waitFor("document.querySelector('[data-fx-stats]')?.innerText.includes('885.75')", 30000);
    await page.setOffline(true); await page.send("Emulation.setScriptExecutionDisabled", { value: false });
    await page.evaluate("window.dispatchEvent(new Event('offline'))");
    await page.waitFor("document.querySelector('[data-fx-stats]')?.innerText.includes('885.75') && document.querySelector('[data-fx-stats]')?.innerText.includes('离线')", 15000);
    await shot("10-offline"); await page.setOffline(false); await page.evaluate("window.dispatchEvent(new Event('online'))");
  });
  await check("七主题浅深、320/390 小屏与英文", async () => {
    for (const palette of ["green","red","orange","yellow","cyan","blue","purple"]) for (const mode of ["light","dark"]) {
      await page.evaluate(`import('/src/lib/theme.ts').then(m=>m.startThemeRuntime().choose({palette:${JSON.stringify(palette)},mode:${JSON.stringify(mode)}}))`);
      for (const width of [320,390]) {
        await page.setViewport(width, 844, true);
        assert(await page.evaluate("document.documentElement.scrollWidth<=window.innerWidth"), `${palette}/${mode}/${width} 横向溢出`);
      }
    }
    await page.evaluate("import('/src/lib/languageRuntime.ts').then(m=>m.startLanguageRuntime().choose('en-US'))");
    await page.waitFor("document.body.innerText.includes('Combined analysis')"); await shot("11-stats-english-dark-390");
    await page.setViewport(320,844,true); await shot("12-stats-english-dark-320");
    assert(await page.evaluate("document.documentElement.scrollWidth<=window.innerWidth"), "英文320px溢出");
    await page.evaluate("import('/src/lib/languageRuntime.ts').then(m=>m.startLanguageRuntime().choose('zh-CN'))");
    await page.evaluate("import('/src/lib/theme.ts').then(m=>m.startThemeRuntime().choose({palette:'green',mode:'light'}))");
    await page.setViewport(390,844,true);
  });
  const logout = async () => {
    await page.navigate(base + "/me");
    await page.waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='退出登录')");
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='退出登录').click()");
    await page.waitFor("document.body.innerText.includes('退出登录？')");
    await page.evaluate("Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.trim()==='退出登录').at(-1).click()");
    await page.waitFor("!document.body.innerText.includes('退出登录？') && !document.body.innerText.includes('汇率验收共享账本')");
  };
  await check("默认币种变更后重新显示，原件不变", async () => {
    await page.navigate(base + "/settings/preferences");
    await page.waitFor("!!document.querySelector('[data-currency=USD]')");
    await page.evaluate("document.querySelector('[data-currency=USD]').click()");
    await page.waitFor("document.querySelector('[data-currency=USD]')?.getAttribute('aria-pressed')==='true' && !document.querySelector('[data-currency=USD]').disabled");
    const cny = config.transactions.find(row => row.currency === "CNY" && row.occurredLocalDate.startsWith("2026"));
    await page.navigate(`${base}/transactions/${cny.id}`); await page.waitFor("document.body.innerText.includes('14.99 USD')"); await shot("15-default-currency-usd");
    await page.navigate(base + "/settings/preferences"); await page.waitFor("!!document.querySelector('[data-currency=CNY]')");
    await page.evaluate("document.querySelector('[data-currency=CNY]').click()");
    await page.waitFor("document.querySelector('[data-currency=CNY]')?.getAttribute('aria-pressed')==='true' && !document.querySelector('[data-currency=CNY]').disabled");
  });
  const enter = async (username, bookId) => {
    const next = await apiLogin(backend, username, config.password);
    await page.send("Network.setCookie", { name: "libellum_session", value: next, url: base, httpOnly: true, sameSite: "Lax" });
    await page.navigate(base + "/settings/appearance"); await page.waitFor("!!document.querySelector('[role=switch]')");
    await page.evaluate(`import('/src/lib/currentBook.ts').then(m=>m.selectBookForReload(${JSON.stringify(bookId)}))`);
    await page.navigate(base + "/settings/appearance"); await page.waitFor("!!document.querySelector('[role=switch]')");
    return next;
  };
  await check("共享成员个人开关/币种与退出清理", async () => {
    await logout();
    const memberCookie = await enter("fx_member", config.bookId);
    const wasEnabled = await page.evaluate("document.querySelector('[role=switch]').checked");
    // 首次成员默认关闭；重跑验收时恢复该账号自己已保存的值。
    if (!wasEnabled) await page.evaluate("document.querySelector('[role=switch]').click()");
    const cny = config.transactions.find(row => row.currency === "CNY" && row.occurredLocalDate.startsWith("2026"));
    await page.navigate(`${base}/transactions/${cny.id}`);
    await page.waitFor("document.body.innerText.includes('14.99 USD')", 15000); await shot("13-member-usd");
    const books = await api(backend, "/books", { cookie: memberCookie });
    const own = books.data.books.find(book => book.id !== config.bookId && book.isCreator);
    assert(!!own, "成员必须有独立个人账本");
    await page.evaluate(`import('/src/lib/currentBook.ts').then(m=>m.selectBookForReload(${JSON.stringify(own.id)}))`);
    await page.navigate(base + "/stats");
    await page.waitFor("document.querySelector('[data-fx-stats]')?.innerText.includes('已折算 0 笔')", 15000);
    assert((await text()).includes("0.00 USD"), "空账本不得串用共享账本统计"); await shot("14-member-empty-book");
    await logout(); cookie = await enter("fx_preview", config.bookId);
    assert(await page.evaluate("document.querySelector('[role=switch]').checked"), "所有者的开关不应被成员影响");
    await page.navigate(base + "/stats"); await page.waitFor("document.querySelector('[data-fx-stats]')?.innerText.includes('885.75 CNY')", 20000);
  });
  await check("显示操作未改原始流水", async () => {
    const after = await api(backend, "/transactions", { cookie, bookId: config.bookId });
    const facts = response => response.data.items.map(row => [row.id, row.amountCents, row.currency, row.occurredLocalDate, row.occurredAt, row.occurredTz, row.kind, row.categoryId, row.note, row.version]).sort();
    assert(JSON.stringify(facts(before)) === JSON.stringify(facts(after)), "原件必须完全一致");
  });
} finally {
  writeFileSync(resolve(directory, "results.json"), JSON.stringify(results, null, 2));
  writeFileSync(resolve(directory, "last-page.txt"), await text());
  page.close();
}
console.log(`${results.length - failures.length}/${results.length} 通过`);
if (failures.length) process.exitCode = 1;
