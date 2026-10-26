/**
 * **S16 头像选择页 UI 验证（真实浏览器，中英双语）。**
 *
 * 检查的是「看起来对不对」，所以每条都量真实布局，而不是读源码：
 * - 头像、名称、系列、题注、解锁状态、创作注记共用同一条水平中轴；
 * - 题注限宽（21rem）且居中，长文案自然换行；
 * - 经典头像切换时预览区高度稳定（题注槽位固定），不会把下方网格顶得上下跳；
 * - 特典系列内部按**真实解锁状态**排序，已解锁在前（顺序与 `GET /avatar-rewards` 一致）；
 * - 未解锁头像保留图案、降饱和、右下角小锁；可以点开预览，但保存按钮禁用；
 * - 未解锁提示文案中英同步；禁用保存按钮文字对比度 ≥ 4.5:1；
 * - 滚动到底部时，固定保存栏不遮挡特典系列最后一行。
 *
 * 前置：本地 `ledger_dev` 里夹具账号（`_backups/avatar-page-copy-20261025/fixture.json`）
 * 至少有一款特典未解锁、一款已解锁；由调用方在跑之前重置（脚本不改数据库）。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { api, apiLogin, assert, openPage, runCase } from "./cdp.mjs";
import { localCandidate } from "./local-candidate.mjs";

const candidate = localCandidate();
const BASE = candidate?.web ?? "https://127.0.0.1:5173";
const API = candidate?.api ?? "http://127.0.0.1:3000/api/v1";
const CDP_PORT = candidate?.port ?? Number(process.env["LIBEVRA_CDP_PORT"] ?? "9236");
const OUT = candidate ? path.join(candidate.outputRoot, "avatars") : "_backups/avatar-picker-ui-20261026";
const FIXTURE = candidate?.avatar ?? JSON.parse(readFileSync("_backups/avatar-page-copy-20261025/fixture.json", "utf8"));

const SPECIALS = ["daoxuan-special", "descent-special"];
const NAMES = {
  "daoxuan-special": { "zh-CN": "倒悬", "en-US": "The Hanged" },
  "descent-special": { "zh-CN": "降临", "en-US": "Descent" },
};
const CLASSICS = ["flower", "sprout", "star", "wave"];
const CLASSIC_NAMES = {
  flower: { "zh-CN": "初绽", "en-US": "First Bloom" },
  sprout: { "zh-CN": "新芽", "en-US": "Sprout" },
  star: { "zh-CN": "晨星", "en-US": "Morning Star" },
  wave: { "zh-CN": "海浪", "en-US": "Wave" },
};

/** 解析 `rgb(r, g, b)` / `rgba(r, g, b, a)`。 */
function parseColor(value) {
  const match = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (!match) return null;
  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

/** 半透明文字/底色先叠到页面底色上再算对比度。 */
function composite(color, canvas) {
  if (!color) return null;
  return {
    r: color.r * color.a + canvas.r * (1 - color.a),
    g: color.g * color.a + canvas.g * (1 - color.a),
    b: color.b * color.a + canvas.b * (1 - color.a),
    a: 1,
  };
}

const measurePreview = `(() => {
  const section = document.querySelector('[aria-label="头像预览"], [aria-label="Avatar preview"]');
  if (!section) return null;
  const container = section.querySelector('div[aria-live]');
  const box = container.getBoundingClientRect();
  const center = box.left + box.width / 2;
  const avatar = section.firstElementChild.getBoundingClientRect();
  const nodes = [...container.children].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  const items = nodes.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      text: (element.textContent ?? "").trim().slice(0, 60),
      center: rect.left + rect.width / 2,
      width: rect.width,
      textAlign: getComputedStyle(element).textAlign,
    };
  });
  const diffs = items.map((item) => Math.abs(item.center - center));
  diffs.push(Math.abs(avatar.left + avatar.width / 2 - center));
  return {
    center,
    avatar: { width: avatar.width, height: avatar.height },
    items,
    maxDiff: Math.max(...diffs),
    sectionHeight: section.getBoundingClientRect().height,
  };
})()`;

const readLockedInfo = (locale) => `(() => {
  const section = document.querySelector('section[aria-labelledby="avatars-special"]');
  const buttons = [...section.querySelectorAll('button[aria-label]')];
  const locked = buttons.filter((button) => button.getAttribute('data-locked') === 'true');
  const first = locked[0];
  const badge = first ? first.querySelector('span.pointer-events-none') : null;
  const svg = first ? first.querySelector('svg') : null;
  const filterTarget = svg ? svg.parentElement : null;
  return {
    order: buttons.map((button) => button.getAttribute('aria-label')),
    lockedCount: locked.length,
    lockedName: first ? first.getAttribute('aria-label') : null,
    hasBadge: badge !== null,
    lockedFilter: filterTarget ? getComputedStyle(filterTarget).filter : null,
  };
})()`;

const readSaveState = (locale) => `(() => {
  const bar = [...document.querySelectorAll('div')].find((element) => element.className.includes('sticky') && element.className.includes('bottom-0'));
  const save = bar ? bar.querySelector('button') : null;
  const hint = bar ? [...bar.querySelectorAll('p')].map((element) => element.textContent.trim()) : [];
  const canvas = getComputedStyle(document.body).backgroundColor;
  const style = save ? getComputedStyle(save) : null;
  return {
    found: save !== null,
    disabled: save ? save.disabled : null,
    text: save ? save.textContent.trim() : null,
    color: style ? style.color : null,
    background: style ? style.backgroundColor : null,
    canvas,
    opacity: style ? style.opacity : null,
    hint,
  };
})()`;

const readUnlockMeta = `(() => {
  const section = document.querySelector('[aria-label="头像预览"], [aria-label="Avatar preview"]');
  const container = section.querySelector('div[aria-live]');
  const paragraphs = [...container.querySelectorAll('p')].map((p) => p.textContent.trim());
  const name = container.querySelector('h2')?.textContent ?? null;
  return { name, paragraphs };
})()`;

const readBottomBar = `(() => {
  const bar = [...document.querySelectorAll('div')].find((element) => element.className.includes('sticky') && element.className.includes('bottom-0'));
  const special = document.querySelector('section[aria-labelledby="avatars-special"]');
  const buttons = [...special.querySelectorAll('button[aria-label]')];
  const last = buttons[buttons.length - 1].getBoundingClientRect();
  const barRect = bar.getBoundingClientRect();
  const specialTitle = special.querySelector('h2').getBoundingClientRect();
  return {
    lastBottom: last.bottom,
    lastTop: last.top,
    barTop: barRect.top,
    barBottom: barRect.bottom,
    specialTitleTop: specialTitle.top,
    viewportHeight: window.innerHeight,
    scrollY: window.scrollY,
    documentHeight: document.documentElement.scrollHeight,
    atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
  };
})()`;

async function setLocale(page, locale) {
  await page.navigate(`${BASE}/`);
  await page.waitFor("document.readyState === 'complete'", 15000);
  await page.evaluate(`localStorage.setItem("libevra.language", ${JSON.stringify(locale)})`);
}

async function openAvatarPage(page, locale, expectedLockedCount) {
  await setLocale(page, locale);
  await page.navigate(`${BASE}/profile/avatar`);
  await page.waitFor(
    `(() => {
      const section = document.querySelector('[aria-label="头像预览"], [aria-label="Avatar preview"]');
      const title = document.querySelector('main h2, h1');
      return section !== null && title !== null;
    })()`,
    15000,
  );
  // 等奖励查询落地（特典排序和锁定状态依赖它）：锁定数量与服务端解锁状态一致才继续。
  await page.waitFor(
    `(() => {
      const section = document.querySelector('section[aria-labelledby="avatars-special"]');
      if (!section || section.querySelectorAll('button[aria-label]').length !== 2) return false;
      return section.querySelectorAll('button[data-locked="true"]').length === ${JSON.stringify(expectedLockedCount)};
    })()`,
    15000,
  );
  await page.waitFor(
    `document.body.innerText.includes(${JSON.stringify(locale === "zh-CN" ? "经典系列" : "Classic Collection")})`,
    15000,
  );
}

async function clickByName(page, name) {
  await page.evaluate(
    `(() => {
      const button = [...document.querySelectorAll('button[aria-label]')].find((element) => element.getAttribute('aria-label') === ${JSON.stringify(name)});
      if (!button) throw new Error('avatar button not found: ' + ${JSON.stringify(name)});
      button.click();
      return true;
    })()`,
  );
  await page.waitFor(
    `(() => {
      const section = document.querySelector('[aria-label="头像预览"], [aria-label="Avatar preview"]');
      const heading = section?.querySelector('h2');
      return heading?.textContent.trim() === ${JSON.stringify(name)};
    })()`,
    10000,
  );
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const results = [];
  const session = await apiLogin(API, FIXTURE.username, FIXTURE.password);
  const rewards = await api(API, "/avatar-rewards", { cookie: session });
  assert(rewards.status === 200, `avatar-rewards ${rewards.status}`);
  const unlockedIds = rewards.data.unlocked.map((entry) => entry.avatarId);
  const expectedOrder = [...SPECIALS].sort(
    (first, second) => Number(unlockedIds.includes(second)) - Number(unlockedIds.includes(first)),
  );
  const expectedLockedCount = SPECIALS.length - unlockedIds.filter((id) => SPECIALS.includes(id)).length;
  const lockedId = specialsFindLocked(unlockedIds);
  const unlockedSpecialId = SPECIALS.find((id) => unlockedIds.includes(id)) ?? null;
  assert(lockedId !== null, "夹具账号没有未解锁的特典，先重置数据库再跑");
  assert(unlockedSpecialId !== null, "夹具账号没有已解锁的特典，先重置数据库再跑");

  const page = await openPage(CDP_PORT, `${BASE}/login`);
  await page.setViewport(390, 844);
  await page.setCookie("libellum_session", session, BASE);

  const zhOrder = NAMES[lockedId]["zh-CN"];
  const zhUnlockedName = NAMES[unlockedSpecialId]["zh-CN"];

  await runCase(results, "zh：打开头像页（默认经典头像）", async () => {
    await openAvatarPage(page, "zh-CN", expectedLockedCount);
    const measure = await page.evaluate(measurePreview);
    assert(measure !== null, "预览区没找到");
    assert(measure.items.length >= 3, `预览文字行数异常：${measure.items.length}`);
    assert(measure.maxDiff <= 1.5, `视觉中轴偏差 ${measure.maxDiff.toFixed(2)}px`);
    const paragraphs = measure.items.filter((item) => item.tag === "P");
    assert(paragraphs.length >= 2, "预览缺少系列/题注文字");
    assert(
      paragraphs.every((item) => item.width <= 353),
      `题注行宽超限：${paragraphs.map((item) => item.width.toFixed(1)).join(",")}`,
    );
    await page.screenshot(path.join(OUT, "03-zh-default.png"));
    return { maxDiff: Number(measure.maxDiff.toFixed(2)), paragraphs };
  });

  await runCase(results, "zh：经典头像切换时预览区高度稳定", async () => {
    const heights = [];
    for (const id of CLASSICS) {
      await clickByName(page, CLASSIC_NAMES[id]["zh-CN"]);
      heights.push(await page.evaluate(`document.querySelector('[aria-label="头像预览"]').getBoundingClientRect().height`));
    }
    const spread = Math.max(...heights) - Math.min(...heights);
    assert(spread <= 1, `切换经典头像时预览区高度跳动 ${spread}px：${heights.join(",")}`);
    return { heights, spread };
  });

  await runCase(results, "zh：特典系列按解锁状态排序（已解锁在前）", async () => {
    await openAvatarPage(page, "zh-CN", expectedLockedCount);
    const info = await page.evaluate(readLockedInfo("zh-CN"));
    assert(info.order.length === 2, `特典数量异常：${info.order.length}`);
    const expected = expectedOrder.map((id) => NAMES[id]["zh-CN"]);
    assert(
      JSON.stringify(info.order) === JSON.stringify(expected),
      `顺序 ${JSON.stringify(info.order)} 与解锁状态期望 ${JSON.stringify(expected)} 不符`,
    );
    return { order: info.order, expected, unlockedIds };
  });

  await runCase(results, "zh：未解锁头像保留图案、降饱和、右下角小锁", async () => {
    const info = await page.evaluate(readLockedInfo("zh-CN"));
    assert(info.lockedCount === 1, `锁定头像数量异常：${info.lockedCount}`);
    assert(info.lockedName === zhOrder, `锁定头像名称异常：${info.lockedName}`);
    assert(info.hasBadge, "未解锁头像缺少小锁标记");
    assert(info.lockedFilter !== null && info.lockedFilter !== "none", "未解锁头像没有降饱和滤镜");
    assert(info.lockedFilter.includes("saturate"), `滤镜不是降饱和：${info.lockedFilter}`);
    return info;
  });

  await runCase(results, "zh：未解锁头像可预览、提示文案正确、保存禁用", async () => {
    await clickByName(page, zhOrder);
    const meta = await page.evaluate(readUnlockMeta);
    assert(meta.name === zhOrder, `预览名称异常：${meta.name}`);
    assert(meta.paragraphs.some((text) => text.includes("特典系列") && text.includes("未解锁")), "系列/锁定标签缺失");
    const save = await page.evaluate(readSaveState("zh-CN"));
    assert(
      save.hint.includes("尚未解锁，暂不可使用"),
      `未解锁提示文案缺失：${JSON.stringify(save.hint)}`,
    );
    assert(save.found, "保存按钮没找到");
    assert(save.disabled === true, "未解锁头像的保存按钮应禁用");
    assert(save.text === "保存", `保存按钮文字异常：${save.text}`);
    const canvas = parseColor(save.canvas);
    const foreground = composite(parseColor(save.color), canvas);
    const background = composite(parseColor(save.background), canvas);
    const ratio = contrastRatio(foreground, background);
    assert(ratio >= 4.5, `禁用保存按钮文字对比度 ${ratio.toFixed(2)}:1 低于 4.5:1`);
    await page.screenshot(path.join(OUT, "02-zh-locked-preview.png"));
    return { ...save, contrast: Number(ratio.toFixed(2)) };
  });

  await runCase(results, "zh：已解锁特典可预览、显示解锁日期、保存可用", async () => {
    await clickByName(page, zhUnlockedName);
    const meta = await page.evaluate(readUnlockMeta);
    assert(meta.name === zhUnlockedName, `预览名称异常：${meta.name}`);
    assert(meta.paragraphs.some((text) => text.includes("已于") && text.includes("解锁")), "已解锁日期缺失");
    const save = await page.evaluate(readSaveState("zh-CN"));
    assert(save.disabled === false, "已解锁特典 + 切换选择时保存按钮应可用");
    await page.screenshot(path.join(OUT, "01-zh-unlocked-special.png"));
    return { name: meta.name, saveDisabled: save.disabled };
  });

  await runCase(results, "zh：滚到底部时固定保存栏不遮挡特典最后一行", async () => {
    await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
    await page.waitFor(`(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2)()`, 5000);
    const bar = await page.evaluate(readBottomBar);
    assert(bar.atBottom, `没有滚动到底：${JSON.stringify(bar)}`);
    assert(bar.lastBottom <= bar.barTop + 1, `最后一行头像被保存栏遮住：${JSON.stringify(bar)}`);
    assert(bar.barBottom <= bar.viewportHeight + 1, "保存栏超出视口底部");
    return bar;
  });

  await runCase(results, "en：预览中轴、题注限宽与英文长文案换行", async () => {
    await openAvatarPage(page, "en-US", expectedLockedCount);
    const measure = await page.evaluate(measurePreview);
    assert(measure !== null, "英文预览区没找到");
    assert(measure.maxDiff <= 1.5, `英文视觉中轴偏差 ${measure.maxDiff.toFixed(2)}px`);
    const paragraphs = measure.items.filter((item) => item.tag === "P");
    assert(paragraphs.every((item) => item.width <= 353), "英文题注行宽超限");
    assert(
      paragraphs.some((item) => item.text.includes("Let a little flower bloom")),
      `英文题注缺失：${JSON.stringify(paragraphs)}`,
    );
    await page.screenshot(path.join(OUT, "06-en-default.png"));
    return { maxDiff: Number(measure.maxDiff.toFixed(2)), paragraphs };
  });

  await runCase(results, "en：特典排序与未解锁提示中英一致", async () => {
    const info = await page.evaluate(readLockedInfo("en-US"));
    const expected = expectedOrder.map((id) => NAMES[id]["en-US"]);
    assert(JSON.stringify(info.order) === JSON.stringify(expected), `英文排序异常：${JSON.stringify(info.order)}`);
    await clickByName(page, NAMES[lockedId]["en-US"]);
    const meta = await page.evaluate(readUnlockMeta);
    assert(meta.name === NAMES[lockedId]["en-US"], "英文预览名称异常");
    const save = await page.evaluate(readSaveState("en-US"));
    assert(save.hint.includes("Not unlocked yet — unavailable for now."), `英文提示缺失：${JSON.stringify(save.hint)}`);
    assert(save.disabled === true, "英文未解锁头像保存按钮应禁用");
    await page.screenshot(path.join(OUT, "05-en-locked-preview.png"));
    const rootText = await page.evaluate(`document.getElementById('root').innerText`);
    assert(!/[\u3400-\u9fff]/u.test(rootText), `英文头像页残留中文：${/[\u3400-\u9fff]/u.exec(rootText)?.[0]}`);
    const canvas = parseColor(save.canvas);
    const ratio = contrastRatio(composite(parseColor(save.color), canvas), composite(parseColor(save.background), canvas));
    assert(ratio >= 4.5, `英文禁用保存按钮对比度 ${ratio.toFixed(2)}:1 低于 4.5:1`);
    return { order: info.order, contrast: Number(ratio.toFixed(2)) };
  });

  await runCase(results, "en：已解锁特典保存可用（解锁日期为英文）", async () => {
    await clickByName(page, NAMES[unlockedSpecialId]["en-US"]);
    const meta = await page.evaluate(readUnlockMeta);
    assert(meta.name === NAMES[unlockedSpecialId]["en-US"], "英文已解锁预览名称异常");
    assert(meta.paragraphs.some((text) => text.startsWith("Unlocked ")), `英文解锁日期缺失：${JSON.stringify(meta.paragraphs)}`);
    const save = await page.evaluate(readSaveState("en-US"));
    assert(save.disabled === false, "英文已解锁特典保存按钮应可用");
    await page.screenshot(path.join(OUT, "04-en-unlocked-special.png"));
    return { name: meta.name };
  });

  page.close();
  const failed = results.filter((item) => item.status !== "pass");
  writeFileSync(
    path.join(OUT, "results.json"),
    `${JSON.stringify({ base: BASE, out: OUT, unlockedIds, expectedOrder, lockedId, unlockedSpecialId, results }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`\n${results.length - failed.length}/${results.length} passed, ${failed.length} failed\n`);
  if (failed.length > 0) {
    for (const item of failed) process.stdout.write(`  FAIL ${item.name}: ${item.error}\n`);
    process.exitCode = 1;
  }
}

/** 夹具里至少要有「未解锁」的特典；两个都锁时取第一个。 */
function specialsFindLocked(unlockedIds) {
  return SPECIALS.find((id) => !unlockedIds.includes(id)) ?? null;
}

await run();
