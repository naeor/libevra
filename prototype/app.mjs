import { ContainerPresentation } from './motion.mjs';

const $ = selector => document.querySelector(selector);
const paths = {
  cup: '<path d="M5 4h11v8a5 5 0 0 1-10 0V4Zm11 2h2a3 3 0 0 1 0 6h-2M4 20h14"/>',
  food: '<path d="M5 3v7m3-7v7M3 6h7m-4 4v11M18 3c-4 4-4 9 0 9m0-9v18"/>',
  train: '<rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 10h14M8 21l2-3m6 3-2-3M9 14h.01M15 14h.01"/>',
  bag: '<path d="M5 8h14l1 13H4L5 8Zm4 0V6a3 3 0 0 1 6 0v2"/>',
  book: '<path d="M4 3h13a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3m-3 15a3 3 0 0 1 3-3h13M8 7h7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M18 18l1.5 1.5M5 19l1.5-1.5M18 6l1.5-1.5"/>',
};
const entries = [
  ['coffee', '街角咖啡', '餐饮 · 今天 09:12', '−28.00', 'cup', '一杯拿铁，开始周末。'],
  ['lunch', '午间小馆', '餐饮 · 今天 12:30', '−46.00', 'food', '和朋友一起吃午饭。'],
  ['metro', '地铁出行', '交通 · 今天 13:08', '−6.00', 'train', '去书店的路上。'],
  ['book', '周末读物', '文化 · 今天 14:25', '−58.00', 'book', '给自己留一点阅读时间。'],
  ['market', '日常采购', '购物 · 今天 16:40', '−126.80', 'bag', '蔬菜、水果和生活用品。'],
  ['dinner', '晚餐', '餐饮 · 今天 18:30', '−38.00', 'food', '简单又热乎的一餐。'],
  ['bus', '公交出行', '交通 · 昨天 08:20', '−2.00', 'train', '普通的一次通勤。'],
  ['breakfast', '晨间早餐', '餐饮 · 昨天 08:45', '−15.00', 'cup', '豆浆和全麦面包。'],
  ['flowers', '一束鲜花', '生活 · 昨天 17:10', '−35.00', 'sun', '给房间添一点颜色。'],
  ['refund', '购物退款', '退款 · 昨天 18:05', '+89.00', 'bag', '已退回原支付账户。'],
  ['reading', '电子书', '文化 · 11 月 6 日', '−19.90', 'book', '加入下一本阅读清单。'],
  ['income', '项目收入', '收入 · 11 月 6 日', '+2,400.00', 'sun', '模拟收入，用于比较不同金额。'],
].map(([id, title, sub, amount, icon, note]) => ({ id, title, sub, amount, icon, note }));
const icons = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const escapeHTML = value => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const styleInfo = {
  a: { name:'A / 柔和空间', description:'先轻轻靠近，再迅速展开。周围记录稍稍退远，固定导航留在原处。', label:'A · 前移倍率', values:[1.02,1.028,1.035], unit:' ×', selected:1.028 },
  b1: { name:'B1 / 实体瓷片', description:'不透明瓷片扩张，附近记录按上下相对位置退让。只做视觉位移，不挤压真实排版。', label:'B1 · 最大退让', values:[12,18,24], unit:' px', selected:18 },
  b2: { name:'B2 / 通透玻璃', description:'真实列表留在原位。玻璃边缘透出颜色与形状，文字区域用稳定底色保持清楚。', label:'B2 · 背景保持原位', values:[0], unit:' px', selected:0 },
  c: { name:'C / 经典纸片', description:'纸面直接展开。周围记录轻移、稍淡，让出注意力；没有悬浮、反射或透射。', label:'C · 轻微退让', values:[4,6,8], unit:' px', selected:6 },
};
let style = 'a', duration = 200, pendingBack = false;
const media = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => media.matches || $('#reduce').checked;
let controller;
function renderRecords() {
  $('#records').innerHTML = entries.map(entry => `<button class="record lv-material lv-material-effects" data-id="${entry.id}" data-material-role="interactive" data-material-finish="auto" aria-label="${entry.title}，${entry.amount} 元，查看详情"><span class="record-content"><span class="record-icon">${icons(entry.icon)}</span><span class="record-info"><span class="record-title">${entry.title}</span><span class="record-sub">${entry.sub}</span></span><span class="record-amount ${entry.amount.startsWith('+') ? 'income' : ''}">${entry.amount}</span></span></button>`).join('');
  updateMaterial();
}
function updateMaterial() { for (const node of document.querySelectorAll('.record')) node.dataset.materialFinish = style === 'b1' ? 'satin' : style === 'b2' ? 'frosted' : 'auto'; }
function detailHTML(entry) {
  return `<div class="detail-toolbar"><button data-back aria-label="返回账目列表">‹</button><h3>账目详情</h3><span></span></div><div class="detail-body"><div class="detail-hero"><span class="record-icon">${icons(entry.icon)}</span><h4>${entry.title}</h4><div class="detail-amount ${entry.amount.startsWith('+') ? 'income' : ''}">${entry.amount}</div><small>人民币 · CNY</small></div><dl><div><dt>分类</dt><dd>${entry.sub.split(' · ')[0]}</dd></div><div><dt>时间</dt><dd>${entry.sub.split(' · ')[1]}</dd></div><div><dt>账户</dt><dd>日常账户</dd></div><div><dt>账本</dt><dd>我的日常账本</dd></div></dl><p class="note">${escapeHTML(entry.note)}</p><button class="detail-action" data-check>标记为已核对</button></div><p class="detail-footnote">模拟账目 · 不会更改真实数据</p>`;
}
function openEntry(id, push = true) {
  if (controller.state !== 'list' || pendingBack) return;
  const source = [...document.querySelectorAll('.record')].find(node => node.dataset.id === id);
  const entry = entries.find(item => item.id === id);
  if (!source || !entry) { if (!push) history.replaceState({ prototype:true }, '', location.pathname); return; }
  if (push) history.pushState({ prototype:true, entry:id }, '', `#entry-${id}`);
  controller.open(source, { style, duration, strength:Number($('#strength').value), content:detailHTML(entry) });
}
function applyScenario() {
  const s = controller.session;
  if (!s || s.scenarioApplied) return;
  s.scenarioApplied = true;
  const scenario = $('#scenario').value;
  if (scenario === 'removed') { s.source.remove(); s.changed = true; }
  if (scenario === 'reordered') { $('#records').append(s.source); s.changed = true; }
  if (scenario === 'offscreen') {
    // 模拟来源变动后的不可见目标，不强制滚到它的位置。
    $('#records').prepend(s.source); s.changed = true;
    if (s.scrollTop < 100) { $('#records').append(s.source); }
  }
}
function requestBack() {
  if (controller.state === 'list' || controller.state === 'closing' || pendingBack) return;
  pendingBack = true;
  if (history.state?.prototype && history.state.entry) history.back();
  else { pendingBack = false; applyScenario(); controller.close(); }
}
controller = new ContainerPresentation({ stage:$('#stage'), list:$('#list'), overlay:$('#overlay'), reduced,
  onState(state, message) {
    $('#status').value = reduced() && state === 'detail' ? '减少动态效果 · 已直接展开详情' : message;
    document.body.dataset.phase = state;
    for (const node of document.querySelectorAll('#styles button,#durations button,#strength,#reset')) node.disabled = state !== 'list';
  },
  onClosed() {
    pendingBack = false;
    // 浏览器在退场期间前进：先完成清理，再呈现当前历史所指向的同一条记录。
    if (history.state?.prototype && history.state.entry) queueMicrotask(() => openEntry(history.state.entry, false));
  },
});
renderRecords();
document.body.dataset.phase = 'list';
history.replaceState({ prototype:true }, '', location.pathname + location.search);
history.scrollRestoration = 'manual';
$('#records').addEventListener('click', event => { const row = event.target.closest('.record'); if (row) openEntry(row.dataset.id); });
$('#overlay').addEventListener('click', event => {
  if (event.target.closest('[data-back]')) requestBack();
  const check = event.target.closest('[data-check]');
  if (check && controller.state === 'detail') { check.textContent = check.getAttribute('aria-pressed') === 'true' ? '标记为已核对' : '已核对 ✓'; check.setAttribute('aria-pressed', String(check.textContent.startsWith('已核对'))); }
});
window.addEventListener('popstate', () => {
  pendingBack = false;
  if (history.state?.prototype && history.state.entry) {
    if (controller.state === 'list') openEntry(history.state.entry, false);
  } else { applyScenario(); controller.close(); }
});
document.addEventListener('keydown', event => {
  if (controller.state === 'list') return;
  if (event.key === 'Escape') { event.preventDefault(); requestBack(); }
  if (event.key === 'Tab') {
    const nodes = [...$('#overlay').querySelectorAll('button:not(:disabled)')];
    if (!nodes.length) return;
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === controller.session.detail)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('#styles').addEventListener('click', event => {
  const button = event.target.closest('[data-style]'); if (!button || controller.state !== 'list') return;
  style = button.dataset.style; document.documentElement.dataset.visualStyle = style;
  for (const node of $('#styles').querySelectorAll('button')) node.setAttribute('aria-pressed', String(node === button));
  const info = styleInfo[style]; $('#preview-style').textContent = info.name; $('#style-description').textContent = info.description;
  $('#tuning label').textContent = info.label;
  $('#strength').innerHTML = info.values.map(value => `<option value="${value}" ${value === info.selected ? 'selected' : ''}>${value}${info.unit}</option>`).join('');
  updateMaterial();
});
$('#durations').addEventListener('click', event => {
  const button = event.target.closest('[data-duration]'); if (!button || controller.state !== 'list') return;
  duration = Number(button.dataset.duration);
  for (const node of $('#durations').querySelectorAll('button')) node.setAttribute('aria-pressed', String(node === button));
  $('#timing-label').textContent = `0 → ${Math.round(duration * .1)} → ${Math.round(duration * .85)} → ${duration} ms`;
});
$('#reset').addEventListener('click', () => { if (controller.state === 'list') { renderRecords(); $('#list').scrollTop = 0; $('#scenario').value = 'normal'; $('#status').value = '模拟列表已重置'; } });
let size = null;
const observer = new ResizeObserver(([entry]) => {
  const next = `${entry.contentRect.width}:${entry.contentRect.height}`;
  if (size && size !== next) controller.refresh(); size = next;
});
observer.observe($('#stage'));
window.visualViewport?.addEventListener('resize', () => controller.refresh());
media.addEventListener('change', () => controller.refresh());
$('#reduce').addEventListener('change', () => controller.refresh());
document.addEventListener('visibilitychange', () => { if (document.hidden && controller.state !== 'list') controller.refresh(); });
window.addEventListener('pagehide', () => { observer.disconnect(); controller.onClosed = () => {}; controller.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
