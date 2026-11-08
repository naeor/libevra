// i18n-ignore-file 本地共享组件交互展示，不读写业务数据。
import { useId, useState } from "react";
import { TextField } from "../../components/TextField.js";
import { PasswordField } from "../../components/PasswordField.js";
import { Button } from "../../components/Button.js";
import { CopyButton } from "../../components/CopyButton.js";
import { Badge, FilterChip, StatusMessage, type StatusTone } from "../../components/ui/StatusControls.js";
import { MotionPresence } from "../../components/ui/ComponentMotion.js";

/** 示例源码本身就是 Gallery 渲染的组件，避免维护一份无法编译的平行代码。 */
export function StandardStates() {
  const [selected, setSelected] = useState(false), [query, setQuery] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [completion, setCompletion] = useState(0), [expanded, setExpanded] = useState(false), [renders, setRenders] = useState(0);
  const contentId = useId();
  const tone: StatusTone = phase === "success" ? "success" : phase === "error" ? "error" : "neutral";
  return <div className="cg-specimen" data-standard-states>
    <h3>标签与筛选</h3><p>Badge 只陈述状态；FilterChip 是可按下的筛选按钮。徽标不伪装成按钮，筛选不会自己修改 URL。</p>
    <div className="cg-row"><Badge>草稿</Badge><Badge tone="success">已完成</Badge><Badge tone="warning">待处理</Badge><Badge tone="error" size="small">失败</Badge></div>
    <div className="cg-row"><FilterChip selected={selected} onSelectedChange={setSelected}>仅看已选</FilterChip><FilterChip selected disabled onSelectedChange={() => undefined}>锁定选择</FilterChip></div>
    <h3>搜索与字段错误</h3><p>普通搜索复用 TextField；明细收缩搜索继续使用专属实现。错误只在业务确认后传入，不因挂载或逐字输入自动报错。</p>
    <TextField type="search" label="搜索示例" value={query} onChange={e => setQuery(e.target.value)} hint="这里只展示输入状态，不请求业务数据" />
    <TextField label="名称" {...(phase === "error" ? { error: "示例：请填写名称" } : {})} hint="下方点击“失败”可查看错误关联" />
    <PasswordField label="密码控件示例" hint="复用既有显示/隐藏控件；请勿填写真实密码" autoComplete="off" />
    <h3>加载、完成与错误</h3><p>加载与完成共用固定图标槽。仅点“完成”递增完成序号，重渲染不会重新反馈。</p>
    <div className="cg-row"><Button type="button" fullWidth={false} variant="secondary" onClick={() => setPhase("loading")}>开始加载</Button><Button type="button" fullWidth={false} onClick={() => { setPhase("success"); setCompletion(n => n + 1); }}>完成</Button><Button type="button" fullWidth={false} variant="danger-quiet" onClick={() => setPhase("error")}>失败</Button></div>
    <StatusMessage tone={tone} loading={phase === "loading"} completion={completion}>{phase === "loading" ? "正在处理示例" : phase === "success" ? "示例操作完成" : phase === "error" ? "示例操作失败" : "等待示例操作"}</StatusMessage>
    <Button type="button" variant="secondary" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(v => !v)}>展开／收起说明</Button>
    <div className="min-h-24"><MotionPresence visible={expanded} id={contentId}><StatusMessage>展开内容复用可见性动效，不叠加高度或回弹动画。关闭后内容退出焦点顺序。</StatusMessage></MotionPresence></div>
    <Button type="button" variant="ghost" data-states-rerender onClick={() => setRenders(n => n + 1)}>保持所有状态 · 重渲染 {renders}</Button>
  </div>;
}

export function StandardStatesExample() {
  return <><StandardStates /><details><summary>完整可复制示例 · 共享组件</summary><CopyButton variant="secondary" label="复制可运行组件" rows={8} text={SOURCE} /></details></>;
}

// ?raw 返回同一份源码；展示段由下方导出函数读取，示例的 props 受真实 TypeScript 检查。
import source from "./StandardStates.tsx?raw";
const SOURCE = source.slice(0, source.indexOf("export function StandardStatesExample"))
  .replace('import { CopyButton } from "../../components/CopyButton.js";\n', "")
  .replaceAll('"../../components/', '"../components/');
