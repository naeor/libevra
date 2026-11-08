// i18n-ignore-file 本地布局组合示例；复制到 src/pages 时将 ../../components 改成 ../components。
import { useRef, useState } from "react";
import { PageNavBar } from "../../components/Layouts.js";
import { Button } from "../../components/Button.js";
import { Card, ActionCard } from "../../components/Card.js";
import { TextField } from "../../components/TextField.js";
import { ListGroup, ListRow } from "../../components/ui/List.js";
import { IconButton, SegmentedControl } from "../../components/ui/PurposeControls.js";
import { FilterChip, StatusMessage } from "../../components/ui/StatusControls.js";
import { useKeyboardInset } from "../../components/entry/keyboardInset.js";

export function HeaderPattern() {
  const [condensed, setCondensed] = useState(false);
  return <div data-layout-example="header" className="mx-auto w-full max-w-md min-w-0">
    <PageNavBar title="很长的页面标题：家庭共同使用的日常记录与说明" condensed={condensed} widthClass="max-w-md" onBack={() => setCondensed(false)} actions={<IconButton label="更多示例操作" onClick={() => setCondensed(v => !v)}>⋯</IconButton>} />
    <header className="px-6 pt-1 pb-6"><h1 className="break-words text-page-title text-ink">家庭共同使用的日常记录与说明</h1><p className="mt-1 break-words text-body-relaxed text-muted">上下文副标题：较长的对象名称可自然换行，不和右上操作抢空间。</p></header>
    <div className="px-6"><Button type="button" variant="secondary" onClick={() => setCondensed(v => !v)}>切换收起标题示意</Button></div>
  </div>;
}

export function ToolbarPattern() {
  const [selected, setSelected] = useState(false), [range, setRange] = useState("all");
  return <div data-layout-example="toolbar" className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-3 px-6">
    <div role="group" aria-label="工具与筛选示例" className="flex flex-wrap items-center gap-2">
      <IconButton label="添加示例" onClick={() => setSelected(true)}>＋</IconButton>
      <IconButton label="清除示例选择" onClick={() => setSelected(false)}>×</IconButton>
      <FilterChip selected={selected} onSelectedChange={setSelected}>只看已选内容</FilterChip>
    </div>
    <SegmentedControl label="布局范围示例" value={range} onChange={setRange} options={[{ value: "all", label: "全部" }, { value: "recent", label: "最近" }, { value: "saved", label: "已保存" }]} />
    <p className="break-words text-helper-relaxed text-muted">窄屏允许工具换行；分段独占下一行。图标目标保持 44px，不缩小文字。</p>
  </div>;
}

export function CardListPattern() {
  const [state, setState] = useState("ready");
  return <div data-layout-example="cards" className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6 px-6">
    <SegmentedControl label="列表状态示例" value={state} onChange={setState} options={[{ value: "ready", label: "内容" }, { value: "empty", label: "空" }, { value: "loading", label: "加载" }, { value: "error", label: "错误" }]} />
    <div className="min-h-24" aria-label="列表结果区域">
      {state === "ready" ? <div className="flex flex-col gap-4">
        <Card><h3 className="break-words text-card-title">一个完整的展示对象</h3><p className="mt-2 break-words text-helper-relaxed text-muted">说明放在内容附近，不为了每一段说明再嵌套卡片。</p></Card>
        <ActionCard onClick={() => setState("empty")}><span className="block break-words text-card-title">可点击对象 · 查看空状态示例</span></ActionCard>
      </div> : <StatusMessage tone={state === "error" ? "error" : "neutral"} loading={state === "loading"}>{state === "empty" ? "暂无内容，可先添加一项。" : state === "loading" ? "正在加载内容" : "暂时无法加载内容，请重试。"}</StatusMessage>}
    </div>
    <ListGroup title="同类条目分组" footer="列表组自身没有 p-6；ListRow 已提供 px-5。">
      <ListRow label="较长的名称：家庭成员共同维护的示例资料" detail="详情说明允许换行" />
      <ListRow label="重新显示内容" tone="action" onClick={() => setState("ready")} />
    </ListGroup>
  </div>;
}

export function FormPattern() {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(0);
  return <form data-layout-example="form" className="mx-auto flex w-full max-w-md min-w-0 flex-col gap-6 px-6" onSubmit={event => { event.preventDefault(); if (!name.trim()) { setError("请填写名称"); return; } setError(""); setCompleted(n => n + 1); }}>
    <div className="flex flex-col gap-4"><TextField label="显示名称" value={name} onChange={e => setName(e.target.value)} hint="字段说明紧贴对应输入；示例只保存在本页" error={error} /><TextField label="备注" placeholder="可选" /></div>
    <div className="min-h-24"><StatusMessage tone={completed ? "success" : "neutral"} completion={completed}>{completed ? "示例保存完成" : "填写后可体验校验和完成反馈"}</StatusMessage></div>
    <div className="grid grid-cols-2 items-stretch gap-3"><Button type="button" variant="secondary" onClick={() => { setName(""); setError(""); }}>取消</Button><Button type="submit">保存</Button></div>
  </form>;
}

export function BottomActionsPattern({ fullPage = false }: { fullPage?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  // 内嵌示意不把“在视口下方”误当成键盘；只有独立满屏入口启用真实 visualViewport 避让。
  const keyboard = useKeyboardInset(frame, fullPage);
  const [completed, setCompleted] = useState(0);
  return <div ref={frame} data-layout-example="bottom" className={`flex min-h-0 w-full flex-col overflow-hidden ${fullPage ? "h-dvh" : "h-96"}`} style={{ paddingBottom: keyboard }}>
    <div className="shrink-0 border-b border-line pt-[max(1rem,env(safe-area-inset-top,0px))] pb-4"><h2 className="mx-auto max-w-md break-words px-6 text-section-title">底部操作区与独立滚动内容</h2></div>
    <div data-layout-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 py-6">
        <StatusMessage completion={completed} tone={completed ? "success" : "neutral"}>{completed ? "已完成示例操作" : "滚动到最后一个输入，检查操作区是否遮挡内容。"}</StatusMessage>
        {Array.from({ length: 6 }, (_, i) => <TextField key={i} label={`示例字段 ${i + 1}`} placeholder="输入内容以检查键盘" />)}
        <p data-layout-last className="break-words text-helper-relaxed text-muted">这是最后一段内容，应能完整滚动到操作区上方。</p>
      </div>
    </div>
    <footer data-layout-actions className="shrink-0 border-t border-line bg-canvas pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      <div className="mx-auto grid w-full max-w-md grid-cols-2 items-stretch gap-3 px-6"><Button type="button" variant="secondary" onClick={() => setCompleted(0)}>取消本次操作</Button><Button type="button" onClick={() => setCompleted(n => n + 1)}>保存并完成</Button></div>
    </footer>
  </div>;
}
