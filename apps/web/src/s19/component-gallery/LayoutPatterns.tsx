// i18n-ignore-file 本地组合规范与代码预览。
import { useLayoutEffect } from "react";
import { CopyButton } from "../../components/CopyButton.js";
import { HeaderPattern, ToolbarPattern, CardListPattern, FormPattern, BottomActionsPattern } from "./LayoutExamples.js";
import { applyB2Glass, B2_GLASS_PRESETS, type B2GlassPreset } from "../b2Glass.js";
import source from "./LayoutExamples.tsx?raw";

const PATTERNS = [
  { id: "header", name: "HeaderPattern", title: "页面头部", note: "普通内页优先 InnerPage。这里直接展示它的 PageNavBar：返回在左，右侧保留一个工具入口；大标题与副标题在正文内换行，小标题省略。示意按钮只切换展示状态，不操作历史。", Component: HeaderPattern },
  { id: "toolbar", name: "ToolbarPattern", title: "工具栏与筛选区", note: "工具 gap-2，筛选与分段 gap-3；内容多时换行，不压缩 44px 点击目标。适合普通列表工具区，不替换明细或分析专属工具栏。", Component: ToolbarPattern },
  { id: "cards", name: "CardListPattern", title: "卡片列表与分组", note: "卡片 gap-4，组间 gap-6。对象用 Card，整块点击用 ActionCard，行列表用 ListGroup；空/加载/错误留在同一结果区域。", Component: CardListPattern },
  { id: "form", name: "FormPattern", title: "表单编辑页面", note: "字段 gap-4，操作区 gap-3，主要操作放右；说明与错误靠近输入。独立表单不必每段都包卡片，也不改输入字号来适应窄屏。", Component: FormPattern },
  { id: "bottom", name: "BottomActionsPattern", title: "底部固定操作区", note: "内容 min-h-0 + flex-1 独立滚动；操作区 shrink-0 作为同级元素始终占位，无需估算遮挡高度。内嵌框仅示意滚动；键盘和整屏安全区请用下方独立入口。", Component: BottomActionsPattern },
] as const;

function codeFor(name: string) {
  const start = source.indexOf(`export function ${name}`);
  const next = source.indexOf("export function ", start + 1);
  return (source.slice(0, source.indexOf("export function ")) + source.slice(start, next < 0 ? undefined : next)).replaceAll('"../../components/', '"../components/');
}

export function LayoutPatterns({ style, preset }: { style: string; preset: B2GlassPreset }) {
  return <div className="flex min-w-0 flex-col gap-6">
    <p>以下均由正式共享组件组合，沿用既有布局工具类。示例边界不代表新增业务容器；代码复制到 src/pages 后可按内容取用。</p>
    {PATTERNS.map(({ id, name, title, note, Component }) => <article key={id} data-pattern={id} className="min-w-0 border-b border-line pb-6">
      <h3 className="mb-2 text-card-title">{title}</h3><p className="mb-4 text-helper-relaxed text-muted">{note}</p>
      <div className="min-w-0 overflow-hidden rounded-card border border-line py-4"><Component /></div>
      {id === "bottom" ? <a className="my-3 inline-flex min-h-11 items-center text-helper text-brand-dark underline" href={`?layout=bottom&style=${style}&preset=${preset}`} target="_blank" rel="noreferrer">打开满屏底部操作区示例 ↗</a> : null}
      <details><summary>完整 TSX 组合 · 复制</summary><CopyButton text={codeFor(name)} label="复制布局代码" variant="secondary" rows={8} /></details>
    </article>)}
  </div>;
}

export function StandaloneBottomPattern() {
  useLayoutEffect(() => {
    const params = new URLSearchParams(location.search), style = params.get("style"), preset = params.get("preset");
    document.documentElement.dataset.visualStyle = style && ["a", "b1", "b2", "c"].includes(style) ? style : "b2";
    const mode = preset && Object.hasOwn(B2_GLASS_PRESETS, preset) ? preset as B2GlassPreset : "balanced";
    applyB2Glass(document.documentElement.style, B2_GLASS_PRESETS[mode], mode);
  }, []);
  return <main className="lv-shell" data-shell="contents"><BottomActionsPattern fullPage /></main>;
}
