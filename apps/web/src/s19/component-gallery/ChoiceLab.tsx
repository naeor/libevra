// i18n-ignore-file 开发用设计样板：其余页面的选择类控件（1.19.68），只含静态示例文字，不读写业务数据、不进正式构建。
import { useLayoutEffect, useMemo, useState } from "react";
import { ActionCard } from "../../components/Card.js";
import { CapsuleButton } from "../../components/ui/PurposeControls.js";
import { MovingSelection, SelectionGrid, SelectionItem } from "../../components/ui/SelectionControls.js";
import { applyB2Glass, B2_GLASS_DEFAULT, B2_GLASS_PRESETS } from "../b2Glass.js";
import { SELECTABLE_AVATAR_IDS } from "@libellum/shared";
import { UserAvatar } from "../../components/UserAvatar.js";
import { CurrencyQuickPick } from "../../components/SettingsCard.js";
import { ThemeAppearanceView } from "../../pages/ThemeAppearancePage.js";
import { LanguageChoiceList } from "../../pages/LanguagePage.js";
import { B2PresetChoices } from "../B2GlassSection.js";
import { WallpaperChoices } from "../WallpaperSection.js";
import { createVisualStyleController } from "../../lib/visualStyle.js";
import type { Wallpaper } from "../wallpaper.js";
import type { ThemePreference } from "../../lib/theme.js";
import type { LanguagePreference } from "../../lib/language.js";
import type { Currency } from "@libellum/shared";
import "../../components/attachments.css";
import "../../components/entry/capture.css";
import "./switch-lab.css";
import "../../statsWorkbench/statsWorkbench.css";
import "../../statsWorkbench/filters.css";
import "../../components/ledger/detail-card-editor.css";

/**
 * **其余页面的选择类控件（1.19.68）**：导出、月份离线下载、拍照单张 / 批量、账本导入审核、冲突页、OCR 概览与账单导入的筛选胶囊、
 * 非重复关系、附件 PDF 缩放、留言引用、批量添加、记账“更多选项”的支付方式、月份选择。
 * 这些页面大多要登录（游客只能到记账、明细、统计、我的），截图到不了，所以这里用与页面相同的写法（同样的组件、类名、容器）核对外观；
 * 正式页面的结构由测试保证。固定画面：`component-gallery.html?shot=choices&part=1|2&s19=original|a|b1|b2|c`（可加 `&theme=dark`）。
 */
const cls = (on: boolean, yes: string, no: string): string => on ? yes : no;

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string; tone?: "danger" }[]; onChange: (value: string) => void }) {
  // 与账本导入审核 SegmentedChoice 同一写法。
  return <MovingSelection axis="x" data-select-track="" role="group" aria-label={label} className="mt-2 grid grid-cols-2 gap-1 rounded-field bg-canvas p-1">
    {options.map(option => { const selected = value === option.value; return <button key={option.value} type="button" aria-pressed={selected} data-select-tone={option.tone} onClick={() => onChange(option.value)}
      className={`rounded-field px-3 py-2 text-helper font-medium transition ${selected ? option.tone === "danger" ? "bg-danger/10 text-danger-dark" : "bg-brand-soft text-brand-dark" : "text-muted hover:text-ink"}`}>{option.label}</button>; })}
  </MovingSelection>;
}

export function ChoiceBoardOne(): React.JSX.Element {
  const [range, setRange] = useState("thisMonth");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [never, setNever] = useState(false);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [source, setSource] = useState("import");
  const [target, setTarget] = useState("remove");
  const [answer, setAnswer] = useState<number | null>(null);
  return <div className="tgl-stage">
    <p className="tgl-cap">导出 · 时间范围（SelectionGrid）与格式（MovingSelection）</p>
    <SelectionGrid data-select-flat="" className="grid grid-cols-2 gap-2">
      {[["thisMonth", "本月"], ["lastMonth", "上月"], ["thisYear", "今年"], ["all", "全部记录"]].map(([id, name]) => <button key={id} type="button" aria-pressed={range === id} onClick={() => setRange(id!)}
        className={`rounded-field px-4 py-3 text-sm transition ${cls(range === id, "bg-brand text-on-brand", "bg-brand-soft text-brand-dark")}`}>{name}</button>)}
      <button type="button" aria-pressed={range === "custom"} onClick={() => setRange("custom")}
        className={`col-span-2 rounded-field px-4 py-3 text-sm transition ${cls(range === "custom", "bg-brand text-on-brand", "bg-brand-soft text-brand-dark")}`}>自定义月份</button>
    </SelectionGrid>
    <MovingSelection axis="x" data-select-flat="" className="grid grid-cols-2 gap-2">
      {([["csv", "CSV", "通用文本，任何表格软件都能打开"], ["xlsx", "Excel", "带格式的工作簿"]] as const).map(([value, label, hint]) => <button key={value} type="button" aria-pressed={format === value} onClick={() => setFormat(value)}
        className={`flex min-w-0 flex-col items-start gap-1 rounded-field px-4 py-3 text-left transition ${cls(format === value, "bg-brand text-on-brand", "bg-brand-soft text-brand-dark")}`}>
        <span className="text-sm font-medium">{label}</span>
        <span className={`text-xs leading-snug ${format === value ? "text-current/80" : "text-current/70"}`}>{hint}</span>
      </button>)}
    </MovingSelection>

    <p className="tgl-cap">月份离线下载 · 自动 / 从不</p>
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3">
      <span className="min-w-0 text-body text-ink">这个月的离线保存</span>
      <MovingSelection axis="x" data-select-flat="" className="flex shrink-0 gap-2">
        {([true, false] as const).map(auto => <button key={String(auto)} type="button" aria-pressed={!never === auto} onClick={() => setNever(!auto)}
          className={`rounded-field px-4 py-2 text-sm font-medium transition ${cls(!never === auto, "bg-brand text-on-brand", "bg-canvas text-muted")}`}>{auto ? "自动" : "从不"}</button>)}
      </MovingSelection>
    </section>

    <p className="tgl-cap">拍照 · 单张 / 批量（ActionCard，MovingSelection 纵向）</p>
    <MovingSelection axis="y" data-select-flat="" className="flex flex-col gap-2" role="group" aria-label="识别方式">
      {([["single", "单张识别", "每张图片各自生成一笔"], ["batch", "批量识别", "几张图片合并成一次确认"]] as const).map(([id, title, hint]) => <ActionCard key={id} aria-pressed={mode === id} onClick={() => setMode(id)}
        style={{ borderRadius: "var(--radius-field)" }} className="lv-scan-mode flex flex-col gap-0.5 px-4 py-3">
        <span className="text-card-title text-ink">{title}</span><span className="text-helper-relaxed text-muted">{hint}</span>
      </ActionCard>)}
    </MovingSelection>

    <p className="tgl-cap">账本导入审核 · 导入 / 跳过，保留 / 删除（与 SegmentedChoice 同一写法）</p>
    <div className="rounded-card border border-line bg-surface px-5 pb-4">
      <Segmented label="来源" value={source} onChange={setSource} options={[{ value: "import", label: "导入" }, { value: "skip", label: "跳过" }]} />
      <Segmented label="目标" value={target} onChange={setTarget} options={[{ value: "keep", label: "保留" }, { value: "remove", label: "删除", tone: "danger" }]} />
    </div>

    <p className="tgl-cap">冲突页 · 本地 / 远端（MovingSelection 纵向，起初都没选）</p>
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="text-body text-ink">备注</p>
      <MovingSelection axis="y" data-select-flat="" className="mt-2 flex flex-col gap-2">
        {["本地", "远端"].map((name, index) => <button key={name} type="button" aria-pressed={answer === index} onClick={() => setAnswer(index)}
          className={`flex items-baseline justify-between gap-3 rounded-field border px-3 py-2 text-left text-sm transition ${answer === index ? "border-brand bg-brand-soft text-ink" : "border-line bg-canvas text-muted hover:border-brand"}`}>
          <span className="shrink-0 text-xs">{name}</span><span className="min-w-0 text-right">{index === 0 ? "午餐" : "工作午餐"}</span>
        </button>)}
      </MovingSelection>
    </div>
  </div>;
}

export function ChoiceBoardTwo(): React.JSX.Element {
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [direction, setDirection] = useState("all");
  const [bill, setBill] = useState("all");
  const [revoked, setRevoked] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState("transactions");
  const [kind, setKind] = useState("expense");
  const [pay, setPay] = useState<string | null>("微信");
  const [month, setMonth] = useState("2026-11");
  return <div className="tgl-stage">
    <p className="tgl-cap">OCR 概览 · 状态（SelectionGrid）、来源（SelectionGrid）、方向（MovingSelection）</p>
    <SelectionGrid className="flex flex-wrap items-center gap-2" role="group" aria-label="状态">
      {[["all", "全部 12"], ["pending", "待处理 5"], ["duplicates", "可能重复 2"], ["confirmed", "已确认 5"]].map(([id, label]) => <CapsuleButton key={id} size="compact" aria-pressed={status === id} onClick={() => setStatus(id!)}>{label}</CapsuleButton>)}
      <CapsuleButton size="compact">筛选</CapsuleButton>
    </SelectionGrid>
    <SelectionGrid className="flex flex-wrap gap-2" role="group" aria-label="来源">
      {[["all", "全部来源"], ["wechat", "微信"], ["alipay", "支付宝"], ["bank", "银行卡"]].map(([id, label]) => <CapsuleButton key={id} size="compact" aria-pressed={source === id} onClick={() => setSource(id!)}>{label}</CapsuleButton>)}
    </SelectionGrid>
    <MovingSelection axis="x" className="flex flex-wrap gap-2" role="group" aria-label="方向">
      {[["all", "全部方向"], ["expense", "支出"], ["income", "收入"]].map(([id, label]) => <CapsuleButton key={id} size="compact" aria-pressed={direction === id} onClick={() => setDirection(id!)}>{label}</CapsuleButton>)}
    </MovingSelection>

    <p className="tgl-cap">账单导入 · 状态筛选（SelectionGrid）</p>
    <SelectionGrid className="flex flex-wrap items-center gap-2" role="group" aria-label="状态">
      {[["all", "全部 30"], ["problem", "有问题 3"], ["duplicate", "可能重复 2"], ["ok", "没问题 25"]].map(([id, label]) => <CapsuleButton key={id} size="compact" aria-pressed={bill === id} onClick={() => setBill(id!)}>{label}</CapsuleButton>)}
    </SelectionGrid>

    <p className="tgl-cap">非重复关系 · 有效 / 含已撤销</p>
    <MovingSelection axis="x" role="group" aria-label="筛选" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={!revoked} onClick={() => setRevoked(false)} className={`rounded-full border px-3 py-1.5 text-helper ${revoked ? "border-line text-muted" : "border-brand bg-brand-soft text-brand-dark"}`}>有效</button>
      <button type="button" aria-pressed={revoked} onClick={() => setRevoked(true)} className={`rounded-full border px-3 py-1.5 text-helper ${revoked ? "border-brand bg-brand-soft text-brand-dark" : "border-line text-muted"}`}>含已撤销</button>
    </MovingSelection>

    <p className="tgl-cap">附件 PDF · 缩放</p>
    <MovingSelection axis="x" data-select-track="" className="lv-attachment-zoom" role="group" aria-label="缩放">
      {[1, 1.5, 2].map(value => <button type="button" key={value} aria-pressed={zoom === value} onClick={() => setZoom(value)}>{value === 1 ? "适合宽度" : `${value * 100}%`}</button>)}
    </MovingSelection>

    <p className="tgl-cap">留言引用 · 账目 / 事件</p>
    <MovingSelection axis="x" data-select-track="" className="flex rounded-field bg-canvas p-1 text-helper">
      {[["transactions", "账目"], ["events", "事件"]].map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id!)}
        className={`flex-1 rounded-field px-3 py-1.5 transition ${tab === id ? "bg-surface font-medium text-ink shadow-sm" : "text-muted"}`}>{label}</button>)}
    </MovingSelection>

    <p className="tgl-cap">批量添加 · 支出 / 收入，记账更多选项 · 支付方式</p>
    <MovingSelection axis="x" data-select-flat="" className="flex gap-2">
      {["expense", "income"].map(id => <button key={id} type="button" aria-pressed={kind === id} onClick={() => setKind(id)}
        className={`flex-1 rounded-field py-2 text-sm ${kind === id ? "bg-brand text-on-brand" : "bg-canvas text-ink"}`}>{id === "expense" ? "支出" : "收入"}</button>)}
    </MovingSelection>
    <SelectionGrid className="flex flex-wrap gap-2">
      {["现金", "微信", "支付宝", "银行卡", "信用卡"].map(name => <button key={name} type="button" aria-pressed={pay === name} onClick={() => setPay(pay === name ? null : name)} data-entry-chip=""
        className={`rounded-full px-4 py-2 text-sm transition ${pay === name ? "bg-brand text-on-brand" : "bg-surface text-ink hover:bg-brand-soft"}`}>{name}</button>)}
    </SelectionGrid>

    <p className="tgl-cap">月份选择 · 月份格与“全部”（SelectionItem；6 月是不可选的月份）</p>
    <ul className="grid grid-cols-3 gap-2">
      {Array.from({ length: 6 }, (_, i) => `2026-${String(i + 6).padStart(2, "0")}`).map(value => <li key={value}>
        <SelectionItem data-select-flat="" aria-pressed={month === value} disabled={value === "2026-06"} onClick={() => setMonth(value)}
          className={`w-full rounded-field py-3 text-sm transition ${value === "2026-06" ? "text-muted/40 cursor-not-allowed" : month === value ? "bg-brand text-on-brand" : "bg-canvas text-ink hover:bg-brand-soft"}`}>{Number(value.slice(5))} 月</SelectionItem></li>)}
    </ul>
    <SelectionItem data-select-flat="" aria-pressed={month === "all"} onClick={() => setMonth("all")} className={`w-full rounded-field py-3 text-sm transition ${month === "all" ? "bg-brand text-on-brand" : "bg-canvas text-ink hover:bg-brand-soft"}`}>全部</SelectionItem>
  </div>;
}

/**
 * **外观与设置（1.19.70）**：外观页的主题明暗 / 主题色 / 视觉风格 / B1 模糊（`ThemeAppearanceView`，真实组件，内存里的控制器）、壁纸、B2 玻璃、
 * 默认货币、语言、头像。这些页面（设置、外观）游客到不了，所以直接渲染正式组件（头像页因为带路由与登录，用同一写法的网格）。
 */
export function ChoiceBoardThree({ style }: { style: string }): React.JSX.Element {
  const [pref, setPref] = useState<ThemePreference>({ mode: "light", palette: "green" });
  const controller = useMemo(() => createVisualStyleController({ dataset: {} }, null, style === "original" ? "original" : style), [style]);
  return <div className="tgl-stage">
    <p className="tgl-cap">外观 · 明暗三选一、主题色、视觉风格、B1 模糊（ThemeAppearanceView）</p>
    <ThemeAppearanceView preference={pref} onChoose={next => setPref({ ...pref, ...next })} controller={controller} />
  </div>;
}

export function ChoiceBoardFive(): React.JSX.Element {
  const [wallpaper, setWallpaper] = useState<Wallpaper>("aurora");
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [language, setLanguage] = useState<LanguagePreference>("zh-CN");
  const [avatar, setAvatar] = useState<string>(SELECTABLE_AVATAR_IDS[2] ?? "");
  const [mode, setMode] = useState<"balanced" | "clear" | "soft">("balanced");
  return <div className="tgl-stage">
    <p className="tgl-cap">壁纸（WallpaperChoices）与 B2 玻璃（B2PresetChoices）</p>
    <WallpaperChoices selected={wallpaper} onChoose={setWallpaper} />
    <B2PresetChoices selection={{ ...B2_GLASS_DEFAULT, mode }} onChoose={preset => setMode(preset)} />
    <p className="tgl-cap">默认货币（CurrencyQuickPick）· 语言（LanguageChoiceList）</p>
    <CurrencyQuickPick value={{ current: currency, pending: false, saved: false, error: null, choose: setCurrency }} />
    <LanguageChoiceList preference={language} locale="zh-CN" onChoose={setLanguage} />
    <p className="tgl-cap">头像（SelectionGrid，头像本身没有底：data-select-plain）</p>
    <SelectionGrid data-select-plain="" className="grid grid-cols-5 gap-x-3 gap-y-4" role="group" aria-label="头像">
      {SELECTABLE_AVATAR_IDS.slice(0, 10).map(id => <button key={id} type="button" aria-label={id} aria-pressed={avatar === id} onClick={() => setAvatar(id)}
        className="group relative flex min-h-11 min-w-0 items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-focus-ring">
        <span className={`w-full rounded-full p-1 ring-2 ring-offset-2 ring-offset-transparent transition ${avatar === id ? "ring-brand" : "ring-transparent group-hover:ring-line"}`}>
          <span className="block rounded-full"><UserAvatar avatarId={id} className="aspect-square w-full" /></span>
        </span>
      </button>)}
    </SelectionGrid>
  </div>;
}

/**
 * **分析工作台、展示卡片编辑器与账本行（1.19.70）**：筛选面板的选项行（SelectionItem，横向可滚动）、统计设置的合并 / 单币种与卡片编辑器的
 * 尺寸 / 时间方式 / 相对窗口（SelectionGrid）、卡片编辑器的模板（SelectionGrid，role="radio"）、卡片尺寸弹层（SelectionGrid）、
 * 展示卡片编辑器的指标（SelectionItem）、账本切换面板的账本行（SelectionItem）。游客分析页只能到筛选面板，其余在这里用同一写法核对。
 */
export function ChoiceBoardFour(): React.JSX.Element {
  const [dims, setDims] = useState<string[]>(["餐饮"]);
  const [range, setRange] = useState("近 30 天");
  const [combined, setCombined] = useState(true);
  const [template, setTemplate] = useState("balanced");
  const [size, setSize] = useState("2×2");
  const [timeMode, setTimeMode] = useState("relative");
  const [win, setWin] = useState("近 30 天");
  const [pick, setPick] = useState("2×3");
  const [metrics, setMetrics] = useState<string[]>(["支出"]);
  const [book, setBook] = useState("家庭账本");
  return <div className="tgl-stage">
    <p className="tgl-cap">分析筛选面板 · 选项行（SelectionItem）与时间行（可横向滚动）</p>
    <div className="sw-choice-wrap"><div className="sw-choice-row" role="group" aria-label="分类">
      {["全部", "餐饮", "交通", "购物", "居家", "娱乐"].map(name => {
        const on = name === "全部" ? dims.length === 0 : dims.includes(name);
        return <SelectionItem key={name} data-select-flat="" aria-pressed={on} className={`sw-chip ${on ? "sw-chip-on" : ""}`}
          onClick={() => setDims(name === "全部" ? [] : dims.includes(name) ? dims.filter(x => x !== name) : [...dims, name])}>{name}</SelectionItem>;
      })}
    </div></div>
    <div className="sw-choice-wrap"><div className="sw-choice-row" role="group" aria-label="时间">
      {["自定义", "近 7 天", "近 30 天", "近 90 天", "今年", "全部"].map(name => <SelectionItem key={name} data-select-flat="" aria-pressed={range === name}
        className={`sw-chip ${range === name ? "sw-chip-on" : ""}`} onClick={() => setRange(name)}>{name}</SelectionItem>)}
    </div></div>

    <p className="tgl-cap">统计设置 · 合并 / 单币种（SelectionGrid）</p>
    <SelectionGrid data-select-flat="" className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={combined} className={`sw-chip ${combined ? "sw-chip-on" : ""}`} onClick={() => setCombined(true)}>合并为 CNY</button>
      {["人民币", "美元", "欧元"].map(name => <button key={name} type="button" aria-pressed={!combined && range === name} className={`sw-chip ${!combined && range === name ? "sw-chip-on" : ""}`}
        onClick={() => { setCombined(false); setRange(name); }}>{name}</button>)}
    </SelectionGrid>

    <p className="tgl-cap">卡片编辑器 · 模板（role="radio"）、尺寸、时间方式、相对窗口</p>
    <SelectionGrid data-select-flat="" className="sw-template-grid" role="radiogroup" aria-label="模板">
      {[["balanced", "均衡", "推荐"], ["wide", "宽幅", "可用"], ["tall", "竖版", "可用"], ["dense", "紧凑", "放不下"]].map(([id, name, status]) =>
        <button key={id} type="button" role="radio" aria-checked={template === id} disabled={id === "dense"} className={`sw-template ${template === id ? "sw-template-on" : ""}`} onClick={() => setTemplate(id!)}>
          <span className="min-w-0"><span className="block truncate text-helper font-medium text-ink">{name}</span><span className="block truncate text-helper text-muted">{status}</span></span>
        </button>)}
    </SelectionGrid>
    <SelectionGrid data-select-flat="" className="flex flex-wrap gap-2" role="radiogroup" aria-label="尺寸">
      {["1×1", "2×1", "2×2", "2×3"].map(id => <button key={id} type="button" role="radio" aria-checked={size === id} className={`sw-chip inline-flex items-center gap-1.5 ${size === id ? "sw-chip-on" : ""}`} onClick={() => setSize(id)}>
        <span className="tabular-nums">{id}</span><span className="text-helper opacity-80">完整显示</span></button>)}
    </SelectionGrid>
    <SelectionGrid data-select-flat="" className="flex flex-wrap gap-2">
      {[["inherit", "跟随全局"], ["relative", "相对窗口"], ["pinned", "固定区间"]].map(([id, name]) => <button key={id} type="button" aria-pressed={timeMode === id} className={`sw-chip ${timeMode === id ? "sw-chip-on" : ""}`} onClick={() => setTimeMode(id!)}>{name}</button>)}
    </SelectionGrid>
    <SelectionGrid data-select-flat="" className="flex flex-wrap gap-2" role="radiogroup" aria-label="相对窗口">
      {["近 7 天", "近 30 天", "近 90 天", "本月"].map(id => <button key={id} type="button" role="radio" aria-checked={win === id} className={`sw-chip sw-chip-sm ${win === id ? "sw-chip-on" : ""}`} onClick={() => setWin(id)}>{id}</button>)}
    </SelectionGrid>

    <p className="tgl-cap">卡片尺寸弹层（SelectionGrid，不可选的是真 disabled）</p>
    <SelectionGrid data-select-flat="" className="grid grid-cols-2 gap-3">
      {["1×1", "2×1", "2×2", "2×3"].map(id => <button key={id} type="button" disabled={id === "1×1"} aria-pressed={pick === id} onClick={() => setPick(id)}
        className={`flex min-h-20 flex-col items-start justify-between gap-2 rounded-field border p-3 text-left transition ${pick === id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-canvas"} disabled:opacity-45`}>
        <span className="text-body font-medium text-ink">{id}</span><span className="text-helper text-muted">{pick === id ? "当前" : id === "1×1" ? "放不下" : "放得下"}</span></button>)}
    </SelectionGrid>

    <p className="tgl-cap">展示卡片编辑器 · 指标（SelectionItem，data-select-flat）</p>
    <div className="dce-catalogue" style={{ overflow: "visible" }}>
      {["支出", "收入", "结余", "笔数"].map(name => { const added = metrics.includes(name); return <SelectionItem key={name} data-select-flat="" className="dce-metric" aria-pressed={added}
        onClick={() => setMetrics(added ? metrics.filter(x => x !== name) : [...metrics, name])}><span><span>{name}</span><small>数值卡片</small></span><span aria-hidden="true">{added ? "✓" : "＋"}</span></SelectionItem>; })}
    </div>

    <p className="tgl-cap">账本切换面板 · 账本行（SelectionItem，点击仍是原来的切换流程，这里只换选中外观）</p>
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      {["个人账本", "家庭账本", "旅行基金"].map(name => <SelectionItem key={name} aria-pressed={book === name} onClick={() => setBook(name)}
        className={`flex min-h-14 w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition last:border-b-0 hover:bg-canvas ${book === name ? "bg-brand-soft/50" : ""}`}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-body text-ink">{name}</span><span className="text-helper text-muted">B-1024 · 3 人</span></span>
        <span className="flex size-6 shrink-0 items-center justify-center text-brand" aria-hidden="true">{book === name ? "✓" : null}</span></SelectionItem>)}
    </div>
  </div>;
}

type ShotStyle = "original" | "a" | "b1" | "b2" | "c";
const SHOT_STYLES: readonly ShotStyle[] = ["original", "a", "b1", "b2", "c"];

/** `?shot=choices&part=1|2`：只渲染这一块画面，五种外观构图完全相同。 */
export function ChoiceShot(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const style = SHOT_STYLES.find(value => value === params.get("s19")) ?? "b2";
  const dark = params.get("theme") === "dark";
  const part = params.get("part") === "3" ? 3 : params.get("part") === "4" ? 4 : params.get("part") === "5" ? 5 : params.get("part") === "2" ? 2 : 1;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (style === "original") delete root.dataset.visualStyle;
    else root.dataset.visualStyle = style;
    root.dataset.themeMode = dark ? "dark" : "light";
    applyB2Glass(root.style, B2_GLASS_PRESETS.balanced, "balanced");
  }, [style, dark]);
  return <main className="lv-shell tgl-shot" data-shell="contents" data-s19-scope="phone">
    <header className="tgl-shot-head"><b>其余选择类控件 · {part}</b><span>{style === "original" ? "Original" : style.toUpperCase()}{dark ? " · 深色" : ""}</span></header>
    {part === 1 ? <ChoiceBoardOne /> : part === 2 ? <ChoiceBoardTwo /> : part === 3 ? <ChoiceBoardThree style={style} /> : part === 5 ? <ChoiceBoardFive /> : <ChoiceBoardFour />}
  </main>;
}
