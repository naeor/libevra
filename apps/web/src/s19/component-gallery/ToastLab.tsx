// i18n-ignore-file 本机提示条样板（1.19.66）：固定示例文字，不读写业务数据。
import { useLayoutEffect, type ReactNode } from "react";

import { Button } from "../../components/Button.js";
import { ToastCard } from "../../components/toast/Toast.js";
import { ToastProvider, useToast, type AppToastOptions } from "../../components/toast/ToastProvider.js";
import { ToastViewport } from "../../components/toast/ToastViewport.js";
import type { ToastView } from "../../lib/toast/types.js";
import { applyB2Glass, B2_GLASS_PRESETS, type B2GlassPreset } from "../b2Glass.js";
import "./toast-lab.css";

/**
 * **第 10 节 · 提示条（Toast）**：直接引用正式组件 `components/toast/`（外观 `ToastCard`、队列 `ToastProvider`、宿主
 * `ToastViewport`）。上半部分是静态样板（同一组场景，截图用），下半部分用真实队列触发。
 *
 * 固定场景：`component-gallery.html?shot=toast&s19=original|a|b1|b2|c`（另可加 `&theme=dark`、`&preset=clear`）只渲染
 * 一块手机尺寸的画面——背后有列表与品牌色卡片（看 B2 玻璃的可读性），前面是同一组提示条——五种外观截出完全相同的构图。
 */
const ACTION = { alternative: "样板页" };
const noop = (): void => undefined;

/** 静态样板的一组场景（方案 §6）。 */
const SCENES: readonly { readonly name: string; readonly view: ToastView<ReactNode> }[] = [
  { name: "保存成功", view: scene(1, { tone: "success", text: "工作台已保存到本机。" }) },
  { name: "带撤销的删除", view: scene(2, { tone: "info", text: "已删除这笔记账", action: { label: "撤销", run: noop, ...ACTION }, closable: true }) },
  { name: "警告", view: scene(3, { tone: "warning", text: "放不下：这一行没有足够的空列，已放到下一行。" }) },
  { name: "网络错误", view: scene(4, { tone: "error", text: "撤销没有完成", detail: "网络连接失败。可稍后从编辑历史打开这笔账目并恢复。", closable: true }) },
  {
    name: "头像奖励",
    view: scene(5, {
      tone: "info",
      text: "获得新头像 · 降临",
      detail: "已收入头像收藏",
      leading: <span className="tl-avatar" aria-hidden="true" />,
      action: { label: "查看", run: noop, ...ACTION },
      closable: true,
    }),
  },
];

function scene(slot: number, partial: Partial<ToastView<ReactNode>> & Pick<ToastView<ReactNode>, "tone" | "text">): ToastView<ReactNode> {
  return { id: slot, slot, appearance: 1, revision: 0, detail: undefined, leading: undefined, action: undefined, closable: false, echo: false, ...partial };
}

const ROWS = ["午餐 · 便利店", "地铁 · 通勤", "咖啡 · 公司楼下", "超市 · 日用品", "电影票 · 周末", "水电 · 十一月", "晚餐 · 家附近", "书 · 网上书店"];
function row(label: string, index: number): React.JSX.Element {
  return (
    <div key={label} className="tl-row">
      <span className="tl-dot" data-kind={index % 3} />
      <span className="tl-row-text">{label}</span>
      <span className="tl-row-amount">-{(index * 13.7 + 18).toFixed(2)}</span>
    </div>
  );
}

/** 背后的内容：列表、品牌色卡片、深色块——B2 玻璃压在不同底色上的可读性。 */
function Backdrop(): React.JSX.Element {
  return (
    <div className="tl-backdrop" aria-hidden="true">
      <div className="tl-brand-card">
        <span>本月支出</span>
        <b>¥ 3,286.40</b>
      </div>
      {ROWS.slice(0, 2).map(row)}
      {/* 深色块放在第三、四条提示后面：B2 玻璃压在深色上是可读性最坏的情况之一。 */}
      <div className="tl-dark-card">图片附件预览</div>
      {ROWS.slice(2).map(row)}
    </div>
  );
}

function StaticStage(): React.JSX.Element {
  return (
    <div className="tl-stage">
      <Backdrop />
      <div className="tl-stack">
        {SCENES.map(({ name, view }) => (
          <div key={name} className="tl-item" data-scene={name}>
            <ToastCard view={view} phase="enter" closeLabel="关闭提示" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 真实队列：按钮触发，宿主在本页的模拟手机外壳里（与正式应用同一个组件）。 */
function LiveButtons(): React.JSX.Element {
  const toast = useToast();
  const show = (options: AppToastOptions) => () => {
    toast.show(options);
  };
  return (
    <div className="tl-buttons">
      <Button type="button" variant="secondary" fullWidth={false} onClick={show({ tone: "success", text: "工作台已保存到本机。" })}>成功</Button>
      <Button type="button" variant="secondary" fullWidth={false} onClick={show({ tone: "info", text: "已删除这笔记账", action: { label: "撤销", run: noop, ...ACTION } })}>带撤销</Button>
      <Button type="button" variant="secondary" fullWidth={false} onClick={show({ tone: "warning", text: "放不下：这一行没有足够的空列，已放到下一行。" })}>警告</Button>
      <Button type="button" variant="secondary" fullWidth={false} onClick={show({ tone: "error", text: "保存失败", detail: "本机存储不可用或布局无效。编辑内容已保留。", key: "demo-save" })}>错误（常驻）</Button>
      <Button type="button" variant="secondary" fullWidth={false} onClick={show({ tone: "success", text: "已保存", key: "demo-save" })}>同 key 成功（替换错误）</Button>
    </div>
  );
}

export function ToastLabSection(): React.JSX.Element {
  return (
    <div className="tl-lab">
      <h3>静态样板（截图用，不需点击）</h3>
      <p>
        同一组场景：保存成功、带撤销的删除、警告、网络错误、头像奖励。Original / C 简洁实心面，A 用 A3 悬浮档（墨色分层阴影），B1 瓷片，B2
        达到操作玻璃下限的磨砂（第二行也用墨色）。固定画面：<code>?shot=toast&amp;s19=b2</code>。
      </p>
      <StaticStage />
      <h3>真实队列</h3>
      <p>同时只显示一条：普通消息互相替换；错误与带操作的提示抢占，被替换的错误回到等待位；同 key 原位更新。悬停或焦点在提示上时暂停，Esc 关闭。</p>
      <LiveButtons />
    </div>
  );
}

type ShotStyle = "original" | "a" | "b1" | "b2" | "c";
const SHOT_STYLES: readonly ShotStyle[] = ["original", "a", "b1", "b2", "c"];

/** `?shot=toast`：只渲染固定画面，五种外观构图完全相同。 */
export function ToastShot(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const style = SHOT_STYLES.find((value) => value === params.get("s19")) ?? "b2";
  const dark = params.get("theme") === "dark";
  const preset = (["clear", "balanced", "soft"] as const).find((value) => value === params.get("preset")) ?? ("balanced" satisfies B2GlassPreset);
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (style === "original") delete root.dataset.visualStyle;
    else root.dataset.visualStyle = style;
    root.dataset.themeMode = dark ? "dark" : "light";
    applyB2Glass(root.style, B2_GLASS_PRESETS[preset], preset);
  }, [style, dark, preset]);
  return (
    <ToastProvider>
      <main className="lv-shell tl-shot" data-shell="contents" data-s19-scope="phone">
        <header className="tl-shot-head">
          <b>提示条</b>
          <span>
            {style === "original" ? "Original" : style.toUpperCase()}
            {style === "b2" ? ` · ${preset}` : ""}
            {dark ? " · 深色" : ""}
          </span>
        </header>
        <StaticStage />
        <ToastViewport kind="phone" />
      </main>
    </ToastProvider>
  );
}
