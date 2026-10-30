/**
 * 编辑结果的**起点**随编辑历史走（1.18.01）。
 *
 * 保存时 `commitLayoutEdit` 需要知道这份结果基于哪份文档：编辑开始时已保存的那份，还是会话里套用的模板 /
 * 恢复的默认（整份替换）。不能按卡片集合去猜——系统默认的卡片 ID 固定，「恢复默认」后的卡片集合可能与已保存
 * 的完全相同；也不能只记「最后一次替换」——撤销到更早的模板后，起点必须跟着回去。
 *
 * 做法：编辑会话里每一个状态的布局文档对象都是新建的，撤销 / 重做恢复的是**同一个对象**（D 的历史快照）。
 * 所以把「布局文档对象 → 起点」登记下来：进入编辑、整份替换时登记；命令新产生的状态没有登记，就取它前一个状态
 * （历史里最近的一条快照）的起点——命令总是从前一个状态推出来的。
 */
import type { EditorState, LayoutDocumentV1 } from "@libellum/shared/analysis/layout";

export class EditOrigins<T> {
  private readonly byLayout = new WeakMap<LayoutDocumentV1, T>();

  register(layout: LayoutDocumentV1, origin: T): void {
    this.byLayout.set(layout, origin);
  }

  /**
   * 这个编辑状态的起点；都找不到时用 `fallback`（编辑开始时的已保存文档）。
   * 找到后顺手登记当前状态：撤销历史最多保留 50 步，登记过的状态不会因为更早的快照被挤出历史而丢掉起点
   * （调用方在每个新状态出现时调用一次，见 `StatsPage`）。
   */
  originOf(state: EditorState, fallback: T): T {
    const direct = this.byLayout.get(state.layout);
    if (direct !== undefined) return direct;
    for (let index = state.history.past.length - 1; index >= 0; index -= 1) {
      const snapshot = state.history.past[index];
      const found = snapshot === undefined ? undefined : this.byLayout.get(snapshot.layout);
      if (found !== undefined) {
        this.byLayout.set(state.layout, found);
        return found;
      }
    }
    return fallback;
  }
}
