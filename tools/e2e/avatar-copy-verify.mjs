import { mkdirSync, readFileSync } from 'node:fs';
import { openPage, apiLogin } from './cdp.mjs';
import { assert } from './cdp.mjs';

/**
 * 头像选择页文案与系列命名（1.16.12）的本地验收：
 * - 「经典系列 / 特典系列」与每款头像的一句描述只在当前预览区显示；
 * - 不出现「轻点预览，保存后才会更换」与底部状态行；
 * - 中英双语、320/390/430 宽度不横向溢出。
 * 截图输出到 `_backups/avatar-page-copy-20261025/`，不进入仓库。
 *
 * 夹具：`_backups/avatar-page-copy-20261025/fixture.json`（username/password/id/bookId）。
 * 本机没有开放注册时，先往开发库 `registration_invites` 插一条邀请码，再 POST
 * `/api/v1/auth/register`；不要复用其他脚本的夹具账号。
 */
const base = 'https://127.0.0.1:5173';
const endpoint = 'http://127.0.0.1:3000/api/v1';
const outDir = '_backups/avatar-page-copy-20261025';
mkdirSync(outDir, { recursive: true });
const fixture = JSON.parse(
  readFileSync(process.env.AVATAR_COPY_FIXTURE ?? `${outDir}/fixture.json`, 'utf8').replace(
    /^\uFEFF/,
    '',
  ),
);
const cookie = await apiLogin(endpoint, fixture.username, fixture.password);
const page = await openPage(9236);
const passed = [];
let step = 'init';
const watchdog = setTimeout(() => {
  console.error(`WATCHDOG: 卡住超过 120s（step=${step}）`);
  process.exit(3);
}, 120000);
watchdog.unref?.();
function enter(name) {
  step = name;
  console.log(`STEP ${name}`);
}
function check(name, condition, detail = '') {
  assert(condition, `${name}${detail === '' ? '' : `：${detail}`}`);
  passed.push(name);
}
const PREVIEW_SELECTOR = '[aria-label="头像预览"],[aria-label="Avatar preview"]';
async function setLanguage(locale) {
  enter(`setLanguage:${locale}`);
  await page.acceptDialog();
  await page.evaluate(`localStorage.setItem('libevra.language', ${JSON.stringify(locale)})`);
  await page.navigate(`${base}/profile/avatar`);
  await page.waitFor(`document.documentElement.lang===${JSON.stringify(locale)}`);
  await page.waitFor(`!!document.querySelector(${JSON.stringify(PREVIEW_SELECTOR)})`);
}
async function preview() {
  return page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(PREVIEW_SELECTOR)}); return { text: el ? el.innerText : '', gridNameless: [...document.querySelectorAll('[role=group] button')].every(b => b.textContent.trim() === ''), overflow: document.documentElement.scrollWidth > innerWidth }; })()`);
}
try {
  await page.send('Security.setIgnoreCertificateErrors', { ignore: true });
  await page.setCookie('libellum_session', cookie);
  await page.setViewport(390, 844, true);

  enter('zh:default');
  await setLanguage('zh-CN');
  const zhDefault = await preview();
  check('中文默认显示经典系列', zhDefault.text.includes('经典系列'), zhDefault.text);
  check('中文默认显示初绽描述', zhDefault.text.includes('开一朵小花，添一点美好。'), zhDefault.text);
  check('网格不显示名称与描述', zhDefault.gridNameless);
  check('中文不再出现冗余提示', !zhDefault.text.includes('轻点预览') && !zhDefault.text.includes('正在预览'));
  check('390 宽度不横向溢出', !zhDefault.overflow);
  await page.screenshot(`${outDir}/zh-CN-default.png`);

  enter('zh:special-daoxuan');
  await page.evaluate(`document.querySelector('button[aria-label="倒悬"]').click()`);
  const zhDao = await preview();
  check('中文特典系列与倒悬描述', zhDao.text.includes('特典系列') && zhDao.text.includes('或许世界本就颠倒'), zhDao.text);
  await page.screenshot(`${outDir}/zh-CN-special-daoxuan.png`);

  enter('zh:special-descent');
  await page.evaluate(`document.querySelector('button[aria-label="降临"]').click()`);
  const zhDescent = await preview();
  check('中文降临描述', zhDescent.text.includes('金色的流星自天外降临此世') && zhDescent.text.includes('特典系列'), zhDescent.text);
  await page.screenshot(`${outDir}/zh-CN-special-descent.png`);

  enter('zh:narrow');
  for (const width of [320, 430]) {
    await page.setViewport(width, 844, width < 500);
    const narrow = await preview();
    check(`${width} 宽度不横向溢出`, !narrow.overflow);
  }
  await page.setViewport(390, 844, true);

  enter('en:default');
  await setLanguage('en-US');
  await page.evaluate(`document.querySelector('button[aria-label="First Bloom"]').click()`);
  const enDefault = await preview();
  check('English 显示 Classic Collection', enDefault.text.includes('Classic Collection'), enDefault.text);
  check('English 显示 First Bloom 描述', enDefault.text.includes('Let a little flower bloom'), enDefault.text);
  check('English 不出现冗余提示', !enDefault.text.includes('Tap to preview') && !enDefault.text.includes('Previewing'));
  await page.screenshot(`${outDir}/en-US-default.png`);

  enter('en:special-hanged');
  await page.evaluate(`document.querySelector('button[aria-label="The Hanged"]').click()`);
  const enSpecial = await preview();
  check('English 显示 Special Collection 与特典描述', enSpecial.text.includes('Special Collection') && enSpecial.text.includes('Perhaps the world has long stood inverted'), enSpecial.text);
  await page.screenshot(`${outDir}/en-US-special.png`);

  enter('en:special-descent');
  await page.evaluate(`document.querySelector('button[aria-label="Descent"]').click()`);
  const enDescent = await preview();
  check('English 显示降临描述', enDescent.text.includes('a golden meteor descends'), enDescent.text);
  await page.screenshot(`${outDir}/en-US-special-descent.png`);

  console.log(JSON.stringify({ ok: true, passed, screenshots: outDir }, null, 2));
} catch (error) {
  console.error(`FAILED at step=${step}:`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  page.close();
}
process.exit(process.exitCode ?? 0);
