/* 图表构件：只输出结构与比例（CSS 变量），外观完全交给各风格的样式表。 */
(function () {
  const LV = (window.LV = window.LV || {});
  const esc = LV.esc;
  const yuan = (v) => LV.money(v, "CNY", { symbol: false }).replace(/\.00$/, "");
  const short = (v) => {
    const y = v / 100;
    if (y >= 10000) return (y / 10000).toFixed(y >= 100000 ? 0 : 1).replace(/\.0$/, "") + "万";
    if (y >= 1000) return (y / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(Math.round(y));
  };
  LV.short = short;

  const C = (LV.chart = {});

  /** 环形图（SVG）。segments: [{value, hue, name}] */
  C.donut = function (segs, o = {}) {
    const size = o.size || 150, th = o.thick || 16, r = (size - th) / 2, cx = size / 2, len = 2 * Math.PI * r;
    const total = segs.reduce((s, x) => s + x.value, 0) || 1;
    const gap = o.gap ?? 3;
    let acc = 0;
    const max = o.max || 6;
    const shown = segs.slice(0, max);
    const rest = segs.slice(max).reduce((s, x) => s + x.value, 0);
    const all = rest ? [...shown, { value: rest, hue: "var(--ch-rest, #c9cfcb)", name: "其他" }] : shown;
    const arcs = all.map((sg) => {
      const l = (sg.value / total) * len;
      // 圆头描边会向两端各伸出半个线宽，所以圆头时要把这部分从弧长里扣掉
      const dash = Math.max(0.01, l - gap - (o.round ? th : 0));
      const off = -(acc + (o.round ? th / 2 : 0));
      const out = `<circle class="ch-arc" cx="${cx}" cy="${cx}" r="${r}" stroke="${sg.hue}" stroke-width="${th}" fill="none" stroke-dasharray="${dash} ${len - dash}" stroke-dashoffset="${off}" ${o.round ? 'stroke-linecap="round"' : ""}/>`;
      acc += l;
      return out;
    }).join("");
    return `<svg class="ch-donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(o.label || "环形图")}"><g transform="rotate(-90 ${cx} ${cx})"><circle class="ch-track" cx="${cx}" cy="${cx}" r="${r}" stroke-width="${th}" fill="none"/>${arcs}</g></svg>`;
  };

  /** 柱形图（HTML）。items: [{label, value, hi, sub}] */
  C.bars = function (items, o = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return `<div class="ch-bars ${o.cls || ""}" role="img" aria-label="${esc(o.label || "")}">${items.map((i) => `<div class="ch-col" ${i.hi ? 'data-hi="true"' : ""} ${i.partial ? 'data-partial="true"' : ""}><span class="ch-val">${o.values === false ? "" : i.value ? short(i.value) : ""}</span><span class="ch-bar"><i style="--v:${(i.value / max).toFixed(4)}"></i></span><span class="ch-lab">${esc(i.label)}</span></div>`).join("")}</div>`;
  };

  /** 收支对开柱：收入向上、支出向下。 */
  C.flow = function (days, o = {}) {
    const max = Math.max(1, ...days.map((d) => Math.max(d.income, d.expense)));
    const sq = (v) => Math.sqrt(v / max); // 平方根比例：工资日不会把其它天压成一条线
    return `<div class="ch-flow ${o.cls || ""}" role="img" aria-label="本月每日收入与支出"><div class="ch-flow-cols">${days.map((d) => `<div class="ch-fcol"><span class="ch-up"><i style="--v:${sq(d.income).toFixed(4)}"></i></span><span class="ch-down"><i style="--v:${sq(d.expense).toFixed(4)}"></i></span><span class="ch-lab">${d.label}</span></div>`).join("")}</div><p class="ch-flow-note">柱高按平方根比例</p></div>`;
  };

  /** 横向排行。items: [{name, value, hue, meta}] */
  C.rank = function (items, o = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    return `<ol class="ch-rank ${o.cls || ""}">${items.map((i, n) => `<li ${o.act ? `data-act="${o.act}" data-id="${i.id}" tabindex="0" role="button"` : ""}><span class="ch-rank-n">${n + 1}</span><span class="ch-rank-main"><span class="ch-rank-top"><span class="ch-rank-name">${i.hue ? `<i class="ch-sw" style="--hue:${i.hue}"></i>` : ""}${esc(i.name)}</span><span class="ch-rank-v">${LV.money(i.value, "CNY")}</span></span>${i.meta ? `<span class="ch-rank-meta">${esc(i.meta)}</span>` : ""}<span class="ch-rank-bar"><i style="--v:${(i.value / max).toFixed(4)};--hue:${i.hue || "var(--ch-1)"}"></i></span></span></li>`).join("")}</ol>`;
  };

  /** 左右分开的变化条。items: [{name, diff, hue}] */
  C.diverge = function (items) {
    const max = Math.max(1, ...items.map((i) => Math.abs(i.diff)));
    return `<ul class="ch-div">${items.map((i) => `<li data-sign="${i.diff >= 0 ? "up" : "down"}"><span class="ch-div-name">${esc(i.name)}</span><span class="ch-div-track"><span class="ch-div-neg">${i.diff < 0 ? `<i style="--v:${(-i.diff / max).toFixed(4)}"></i>` : ""}</span><span class="ch-div-pos">${i.diff > 0 ? `<i style="--v:${(i.diff / max).toFixed(4)}"></i>` : ""}</span></span><span class="ch-div-v">${i.diff >= 0 ? "+" : "−"}${yuan(Math.abs(i.diff))}</span></li>`).join("")}</ul>`;
  };

  /** 100% 堆叠条（精致排版方案用来代替环形图）。 */
  C.stack = function (segs, o = {}) {
    const total = segs.reduce((s, x) => s + x.value, 0) || 1;
    return `<div class="ch-stack" role="img" aria-label="${esc(o.label || "构成")}">${segs.map((s) => `<i style="--w:${((s.value / total) * 100).toFixed(3)}%;--hue:${s.hue}" title="${esc(s.name)}"></i>`).join("")}</div>`;
  };

  /** 折线（SVG），用于每周支出等少量点位。 */
  C.line = function (items, o = {}) {
    const w = o.w || 300, h = o.h || 90, padX = 10, padY = 14;
    const max = Math.max(1, ...items.map((i) => i.value));
    const pts = items.map((it, i) => [padX + (i * (w - padX * 2)) / Math.max(1, items.length - 1), h - padY - (it.value / max) * (h - padY * 2)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = `${d} L ${pts.at(-1)[0].toFixed(1)} ${h - padY} L ${pts[0][0].toFixed(1)} ${h - padY} Z`;
    return `<svg class="ch-line" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(o.label || "")}"><path class="ch-area" d="${area}"/><path class="ch-path" d="${d}" fill="none" vector-effect="non-scaling-stroke"/>${pts.map((p, i) => `<circle class="ch-pt" ${items[i].partial ? 'data-partial="true"' : ""} cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" vector-effect="non-scaling-stroke"/>`).join("")}</svg>`;
  };
})();
