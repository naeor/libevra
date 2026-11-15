// i18n-ignore-file 本机设计评审，示例数据仅存于 React 状态。
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Card } from "../../components/Card.js";
import { Button } from "../../components/Button.js";
import { TextField } from "../../components/TextField.js";
import { BottomSheet } from "../../components/BottomSheet.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { SegmentedControl, Switch } from "../../components/ui/PurposeControls.js";
import { ToastProvider, useToast } from "../../components/toast/ToastProvider.js";
import { ToastViewport } from "../../components/toast/ToastViewport.js";
import { StandardStates } from "./StandardStates.js";
import "../../index.css";
import "../s19.css";
import "../overlays.css";
import "./dark-study-tokens.css";
import "./light-field.css";

const styles = [{ value: "a", label: "A" }, { value: "b1", label: "B1" }, { value: "b2", label: "B2" }, { value: "c", label: "C" }] as const;
type Style = typeof styles[number]["value"];
const fieldLevels = [{ value: "off", label: "关闭" }, { value: "soft", label: "轻" }, { value: "defined", label: "稍明显" }] as const;
type FieldLevel = typeof fieldLevels[number]["value"];
const names = { a: "柔和空间", b1: "深色瓷片", b2: "层叠玻璃", c: "经典精修" };

function Study() {
  const query = new URLSearchParams(location.search);
  const [style, setStyle] = useState<Style>(() => styles.find(item => item.value === query.get("s19"))?.value ?? "b2");
  const fieldEnabled = query.has("field");
  const [field, setField] = useState<FieldLevel>(() => fieldLevels.find(item => item.value === query.get("field"))?.value ?? "soft");
  const [opaque, setOpaque] = useState(query.get("opaque") === "1");
  const [note, setNote] = useState("午间咖啡");
  const [panel, setPanel] = useState<"sheet" | "confirm" | null>(null);
  const toast = useToast();
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.visualStyle = style;
    root.toggleAttribute("data-study-opaque", opaque);
    if (fieldEnabled) root.dataset.studyField = style === "c" ? "off" : field;
    else delete root.dataset.studyField;
  }, [style, opaque, fieldEnabled, field]);
  return <main className="lv-shell" data-shell="contents" data-s19-scope="phone">
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pt-7 pb-10">
      <header><p className="text-helper text-muted">四风格深色样板</p><h1 className="mt-1 text-page-title">{names[style]}</h1></header>
      <SegmentedControl label="视觉风格" value={style} options={styles} onChange={setStyle} />
      {fieldEnabled && <div className="grid gap-2">
        {style !== "c" && <SegmentedControl label="共享光场强度" value={style === "a" && field !== "off" ? "soft" : field} options={style === "a" ? [{ value: "off", label: "关闭" }, { value: "soft", label: "均匀灰化" }] : fieldLevels} onChange={setField} />}
        <a className="text-helper text-muted underline" href={new URL("../neutral-light-field.png", import.meta.url).href}>查看共享黑灰光场原图</a>
      </div>}
      <Card appearance={{ finish: style === "b1" ? "satin" : style === "b2" ? "frosted" : "auto" }}>
        <p className="text-helper text-muted">本月支出</p><strong className="mt-1 block text-3xl tabular-nums">¥ 2,486.50</strong>
      </Card>
      <Card appearance={{ finish: style === "b1" ? "glazed" : "auto" }}>
        <TextField label="账目备注" value={note} onChange={event => setNote(event.target.value)} />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setPanel("sheet")}>编辑备注</Button>
          <Button onClick={() => toast.show({ tone: "success", text: "备注已更新" })}>保存示例</Button>
        </div>
      </Card>
      <Button variant="danger-quiet" onClick={() => setPanel("confirm")}>移除备注</Button>
      {style === "b2" && <Switch checked={opaque} onCheckedChange={setOpaque}>减少透明度预览</Switch>}
      <details><summary className="py-2 text-helper text-muted">查看标签、错误、加载和禁用状态</summary><StandardStates /></details>
    </div>
    {panel === "sheet" && <BottomSheet label="编辑备注" onClose={() => setPanel(null)}>{close => <div className="grid gap-4 p-6"><h2 className="text-section-title">编辑备注</h2><TextField label="账目备注" value={note} onChange={event => setNote(event.target.value)} /><Button onClick={close}>完成</Button></div>}</BottomSheet>}
    <ConfirmDialog open={panel === "confirm"} title="移除这条备注？" description="金额和分类将保留。" confirmLabel="移除备注" onConfirm={() => { setNote(""); setPanel(null); }} onCancel={() => setPanel(null)} />
    <ToastViewport kind="phone" />
  </main>;
}
const root = createRoot(document.getElementById("component-gallery")!);
root.render(<ToastProvider><Study /></ToastProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());