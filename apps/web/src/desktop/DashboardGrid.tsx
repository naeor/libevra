import { useEffect, useRef, useState } from "react";
import { positionToRowCol, rowColToPosition, type ObjectGeometry } from "@libellum/shared/analysis/layout";
import { useI18n } from "../i18n/index.js";
import { useDragController, type DragState } from "../statsWorkbench/dnd.js";
import { dashboardColumns, dashboardGeometry, placeDashboardCard, updateCard, type DashboardCard, type DashboardConfig } from "./dashboardModel.js";
import { useElementWidth } from "./DesktopSplit.js";

/** 与分析工作台共用拖动控制器和落位算法；数字输入是键盘/非拖动的等价入口。 */
export function DashboardGrid({ config, editing, onChange, render, tools, scrollRef }: {
  readonly config: DashboardConfig;
  readonly editing: boolean;
  readonly onChange: (config: DashboardConfig) => void;
  readonly render: (card: DashboardCard) => React.ReactNode;
  readonly tools: (card: DashboardCard) => React.ReactNode;
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const { t } = useI18n();
  const box = useElementWidth<HTMLDivElement>();
  const [editCols, setEditCols] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<ObjectGeometry | null>(null);
  const auto = dashboardColumns(box.width);
  const columns = editing ? editCols ?? Math.min(config.layout?.baseCols ?? auto, auto) : Math.min(config.layout?.baseCols ?? auto, auto);
  useEffect(() => { setEditCols(editing ? Math.min(config.layout?.baseCols ?? auto, auto) : null); }, [editing, config.layout?.baseCols]); // 编辑会话锁列，窗口变化只改变格子的像素大小。
  const layout = dashboardGeometry(config, columns);
  const current = layout.objects.find((item) => item.objectId === selected);
  const card = config.cards.find((item) => item.id === selected && !item.hidden);
  const latest = useRef({ config, columns, layout });
  latest.current = { config, columns, layout };

  const target = (state: DragState): ObjectGeometry | null => {
    const rect = box.ref.current?.getBoundingClientRect();
    if (rect === undefined || state.payload.kind !== "object") return null;
    const resizing = state.payload.objectId.startsWith("resize:");
    const id = resizing ? state.payload.objectId.slice(7) : state.payload.objectId;
    const object = latest.current.layout.objects.find((item) => item.objectId === id);
    if (object === undefined) return null;
    const cols = latest.current.columns;
    const unit = (rect.width + 12) / cols;
    const at = positionToRowCol(object.anchor, cols);
    const col = Math.max(1, Math.min(cols, Math.floor((state.x - rect.left) / unit) + 1));
    const row = Math.max(1, Math.min(100, Math.floor((state.y - rect.top) / 128) + 1));
    if (resizing) return { ...object, colSpan: Math.max(1, Math.min(cols - at.col + 1, col - at.col + 1)), rowSpan: Math.max(2, Math.min(8, row - at.row + 1)) };
    return { ...object, anchor: rowColToPosition(Math.max(1, row - state.payload.grab.row), Math.max(1, Math.min(col - state.payload.grab.col, cols - object.colSpan + 1)), cols) };
  };
  const drag = useDragController({
    scrollRef,
    onMove: (state) => setPreview(target(state)),
    onCancel: () => setPreview(null),
    onDrop: (state) => {
      const candidate = target(state);
      if (candidate !== null) onChange(placeDashboardCard(latest.current.config, latest.current.columns, candidate));
      setPreview(null);
    },
  });
  const patch = (values: Partial<ObjectGeometry>) => {
    if (current !== undefined) onChange(placeDashboardCard(config, columns, { ...current, ...values }));
  };
  const position = current === undefined ? null : positionToRowCol(current.anchor, columns);
  const numeric = (label: string, value: number, max: number, change: (value: number) => void, min = 1) => (
    <label className="lv-dash-number text-helper"><span>{label}</span><input type="number" min={min} max={max} value={value} onChange={(event) => {
      const next = Number(event.target.value);
      if (Number.isInteger(next) && next >= min && next <= max) change(next);
    }} /></label>
  );
  return (
    <>
      {editing ? <div className="lv-dash-grid-tools">
        {numeric(t("desktop.dashboard.columns"), columns, auto, (value) => {
          setEditCols(value);
          onChange({ ...config, layout: dashboardGeometry(config, value) });
        })}
        {current !== undefined && card !== undefined && position !== null ? <>
          {numeric(t("desktop.dashboard.width"), current.colSpan, columns, (value) => patch({ colSpan: value, anchor: rowColToPosition(position.row, Math.min(position.col, columns - value + 1), columns) }))}
          {numeric(t("desktop.dashboard.height"), current.rowSpan, 8, (value) => patch({ rowSpan: value }), 2)}
          {numeric(t("desktop.dashboard.row"), position.row, 100, (value) => patch({ anchor: rowColToPosition(value, position.col, columns) }))}
          {numeric(t("desktop.dashboard.column"), position.col, columns - current.colSpan + 1, (value) => patch({ anchor: rowColToPosition(position.row, value, columns) }))}
          {tools(card)}
          <button className="lv-desk-btn" onClick={() => onChange(updateCard(config, card.id, { hidden: true }))}>{t("desktop.dashboard.hide")}</button>
        </> : <p className="text-helper text-muted">{t("desktop.dashboard.selectCard")}</p>}
      </div> : null}
      <div ref={box.ref} className="lv-dash-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} data-editing={editing || undefined}>
        {layout.objects.map((item) => {
          const content = config.cards.find((entry) => entry.id === item.objectId)!;
          const { row, col } = positionToRowCol(item.anchor, columns);
          const source = (resize: boolean) => drag.sourceProps((event) => {
            const rect = box.ref.current?.getBoundingClientRect();
            if (rect === undefined) return null;
            const unit = (rect.width + 12) / columns;
            const grab = { col: Math.floor((event.clientX - rect.left) / unit) + 1 - col, row: Math.floor((event.clientY - rect.top) / 128) + 1 - row };
            return { kind: "object", objectId: `${resize ? "resize:" : ""}${item.objectId}`, size: item, grab, label: item.objectId };
          });
          return <div key={item.objectId} className="lv-dash-cell" data-selected={editing && selected === item.objectId || undefined} style={{ gridColumn: `${col} / span ${item.colSpan}`, gridRow: `${row} / span ${item.rowSpan}` }}
            onClickCapture={(event) => { if (!editing) return; event.preventDefault(); event.stopPropagation(); if (!drag.consumeClick()) setSelected(item.objectId); }}>
            {render(content)}
            {editing ? <>
              <button type="button" className="lv-dash-move" aria-label={t("desktop.dashboard.moveCard")} {...source(false)} onFocus={() => setSelected(item.objectId)}>⠿ <span>{t("desktop.dashboard.moveCard")}</span></button>
              <button type="button" className="lv-dash-resize" aria-label={t("desktop.dashboard.resizeCard")} {...source(true)} onFocus={() => setSelected(item.objectId)}>↘</button>
            </> : null}
          </div>;
        })}
        {preview === null ? null : <div className="lv-dash-drop" aria-hidden="true" style={{ gridColumn: `${positionToRowCol(preview.anchor, columns).col} / span ${preview.colSpan}`, gridRow: `${positionToRowCol(preview.anchor, columns).row} / span ${preview.rowSpan}` }} />}
      </div>
    </>
  );
}
