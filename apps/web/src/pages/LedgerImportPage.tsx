import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { InnerPage } from "../components/Layouts.js";
import { SkeletonRows } from "../components/States.js";
import { errorMessage } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import { formatTimeWithZone } from "../lib/datetime.js";
import {
  hasLocalGuestIdentity,
  isSoloImportBook,
  loadBookImportSource,
  loadBookImportTarget,
  loadGuestImportSource,
} from "../lib/ledgerImport/sources.js";
import { buildImportPreview } from "../lib/ledgerImport/preview.js";
import type {
  DuplicateGroup,
  ImportBookOption,
  ImportPreview,
  TaxonomyConflict,
} from "../lib/ledgerImport/types.js";
import { useBooks } from "../lib/queries.js";

/**
 * S14-D D1 · 导入账本预览。
 *
 * ⚠️ **本页是只读的。** 它读取来源/目标快照，计算分类映射、重复组与摘要，但**没有任何写接口调用**。
 * 写入、冲突逐组决定和来源账本删除分别在 D2/D3/D5 实现。
 *
 * 产品语义：A = 目标账本，B = 来源账本；来源既可以是本机游客账本，也可以是同一账号下另一本单人账本。
 * 页面不默认选择来源，也不在用户不知情时切换任何账本。
 */
export function LedgerImportPage(): React.JSX.Element {
  const { user } = useAuth();
  const books = useBooks();
  const [search] = useSearchParams();
  const queryTarget = search.get("target") ?? "";

  const [targetId, setTargetId] = useState(queryTarget);
  const [sourceKey, setSourceKey] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guestAvailable = useMemo(() => hasLocalGuestIdentity(), []);

  const soloBooks = useMemo<readonly ImportBookOption[]>(() => {
    const list = books.data?.books ?? [];
    return list.filter((book) => isSoloImportBook(book)).map((book) => ({ ...book }));
  }, [books.data]);

  const targetOptions = soloBooks;
  const sourceOptions = useMemo(() => soloBooks.filter((book) => book.id !== targetId), [soloBooks, targetId]);
  const target = soloBooks.find((book) => book.id === targetId) ?? null;
  const sourceBook = sourceOptions.find((book) => book.id === sourceKey) ?? null;
  const accountLabel = user === null ? "正式账号" : user.displayName.trim() === "" ? user.username : user.displayName;

  if (books.isPending) {
    return (
      <InnerPage title="导入账本" subtitle="先读取你的账本列表。" backTo="/start">
        <SkeletonRows rows={4} />
      </InnerPage>
    );
  }

  async function generatePreview(): Promise<void> {
    setError(null);
    if (targetId === "") {
      setError("请先选择目标账本 A。");
      return;
    }
    if (sourceKey === "") {
      setError("请选择来源账本 B。");
      return;
    }
    if (sourceKey === targetId) {
      setError("来源账本和目标账本不能是同一本。");
      return;
    }

    setBusy(true);
    setPreview(null);
    try {
      const targetSnapshot = await loadBookImportTarget(targetId);
      const sourceSnapshot =
        sourceKey === "guest" ? await loadGuestImportSource() : await loadBookImportSource(sourceKey);
      if (sourceSnapshot === null) {
        throw new Error("没有找到本机游客账本。");
      }
      if (sourceSnapshot.kind === "book" && sourceSnapshot.bookId === targetSnapshot.bookId) {
        throw new Error("来源账本和目标账本不能是同一本。");
      }
      setPreview(buildImportPreview(sourceSnapshot, targetSnapshot));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function clearPreview(): void {
    setPreview(null);
    setError(null);
  }

  return (
    <InnerPage
      title="导入账本"
      subtitle="把来源账本 B 的记录复制到目标账本 A。先预览，确认后才会写入；本页不会修改任何账本。"
      backTo={targetId === "" ? "/start" : `/books/${targetId}/settings`}
    >
      <Alert tone="info">
        当前为导入预览：会读取两本账并进行分类映射与重复检测，不会写入或删除任何数据。
      </Alert>
      {error === null ? null : <Alert>{error}</Alert>}
      {books.isError ? <Alert>{errorMessage(books.error)}</Alert> : null}

      {soloBooks.length === 0 ? (
        <section className="rounded-card border border-line bg-surface p-5 text-body-relaxed text-muted">
          没有可用于导入的单人账本。导入来源/目标必须是本人拥有、没有其他协作者的账本。
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
            <h2 className="text-section-title font-semibold text-ink">目标账本 A</h2>
            <p className="text-helper-relaxed text-muted">
              导入的数据会写入这本账；它已有的账目编号不会改变。
            </p>
            <label className="flex flex-col gap-2 text-body text-ink">
              <span className="text-helper text-muted">选择目标账本</span>
              <select
                data-testid="import-target"
                value={targetId}
                onChange={(event) => {
                  const next = event.target.value;
                  setTargetId(next);
                  if (sourceKey === next) setSourceKey("");
                  clearPreview();
                }}
                className="rounded-field border border-line bg-surface px-4 py-3 text-ink"
              >
                <option value="">请选择目标账本</option>
                {targetOptions.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                    {book.bookNumber === null ? "" : `（${book.bookNumber}）`}
                  </option>
                ))}
              </select>
            </label>
            {target === null ? null : (
              <div className="rounded-field bg-brand-soft px-4 py-3 text-sm text-brand-dark">
                <p className="font-medium">导入到「{target.name}」</p>
                <p className="mt-1">
                  所属账号：{accountLabel}
                  {target.bookNumber === null ? "" : ` · 账本编号 ${target.bookNumber}`}
                </p>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
            <h2 className="text-section-title font-semibold text-ink">来源账本 B</h2>
            <p className="text-helper-relaxed text-muted">
              只能选择本机游客账本，或同一账号下另一本本人拥有的单人账本。来源账本本身不会被修改。
            </p>
            <label className="flex flex-col gap-2 text-body text-ink">
              <span className="text-helper text-muted">选择来源账本</span>
              <select
                data-testid="import-source"
                value={sourceKey}
                onChange={(event) => {
                  setSourceKey(event.target.value);
                  clearPreview();
                }}
                className="rounded-field border border-line bg-surface px-4 py-3 text-ink"
              >
                <option value="">请选择来源账本</option>
                {guestAvailable ? <option value="guest">本机游客账本（不上传身份）</option> : null}
                {sourceOptions.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                    {book.bookNumber === null ? "" : `（${book.bookNumber}）`}
                  </option>
                ))}
              </select>
            </label>
            {sourceBook === null && sourceKey !== "guest" ? null : (
              <div className="rounded-field bg-canvas px-4 py-3 text-sm text-ink">
                <p className="font-medium">
                  来源：{sourceKey === "guest" ? "本机游客账本" : sourceBook?.name}
                </p>
                <p className="mt-1 text-muted">
                  {sourceKey === "guest"
                    ? "游客数据只在本机；本次预览不会上传。"
                    : `所属账号：${accountLabel}${sourceBook?.bookNumber == null ? "" : ` · 账本编号 ${sourceBook.bookNumber}`}`}
                </p>
              </div>
            )}
            {!guestAvailable && soloBooks.length <= 1 ? (
              <p className="text-helper-relaxed text-muted">
                本机没有游客账本，也没有另一本可导入的单人账本。
              </p>
            ) : null}
          </section>

          <Button onClick={() => void generatePreview()} disabled={busy || targetId === "" || sourceKey === ""}>
            {busy ? "正在读取并计算预览…" : "生成预览"}
          </Button>

          {preview === null ? null : (
            <PreviewView
              preview={preview}
              onClear={clearPreview}
            />
          )}
        </>
      )}
    </InnerPage>
  );
}

function PreviewView({
  preview,
  onClear,
}: {
  readonly preview: ImportPreview;
  readonly onClear: () => void;
}): React.JSX.Element {
  return (
    <section data-testid="import-preview" className="flex flex-col gap-4">
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-section-title font-semibold text-ink">预览摘要</h2>
        <dl className="mt-3 flex flex-col gap-2 text-body">
          <SummaryRow label="来源 B" value={`${preview.source.identity.name}${preview.source.identity.bookNumber === null ? "" : `（${preview.source.identity.bookNumber}）`}`} />
          <SummaryRow label="目标 A" value={`${preview.target.identity.name}${preview.target.identity.bookNumber === null ? "" : `（${preview.target.identity.bookNumber}）`}`} />
          <SummaryRow label="来源记录" value={`${String(preview.counts.sourceTransactions)} 条`} />
          <SummaryRow label="目标已有" value={`${String(preview.counts.targetTransactions)} 条`} />
          <SummaryRow label="无重复、默认待导入" value={`${String(preview.counts.importableWithoutConflict)} 条`} />
          <SummaryRow
            label="可能重复"
            value={`${String(preview.counts.duplicateSourceRecords)} 条来源 / ${String(preview.counts.duplicateTargetRecords)} 条目标 · ${String(preview.counts.duplicateGroups)} 组`}
          />
          <SummaryRow
            label="来源日期范围"
            value={
              preview.dateRange.from === null || preview.dateRange.to === null
                ? "没有记录"
                : `${preview.dateRange.from.slice(0, 10)} 至 ${preview.dateRange.to.slice(0, 10)}`
            }
          />
        </dl>
      </div>

      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-section-title font-semibold text-ink">金额概览</h2>
        {preview.totals.length === 0 ? (
          <p className="mt-2 text-helper-relaxed text-muted">来源没有账目。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {preview.totals.map((total) => (
              <li key={total.currency} className="flex items-center justify-between gap-3 text-body">
                <span className="text-muted">{total.currency}</span>
                <span className="text-ink">
                  支出 {formatMoney(total.expenseCents, total.currency)} · 收入 {formatMoney(total.incomeCents, total.currency)} · {String(total.count)} 条
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TaxonomyView preview={preview} />

      {preview.warnings.length > 0 ? (
        <div className="flex flex-col gap-2">
          {preview.warnings.map((warning) => (
            <Alert key={warning} tone="info">
              {warning}
            </Alert>
          ))}
        </div>
      ) : null}

      {preview.duplicateGroups.length === 0 ? null : (
        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-section-title font-semibold text-ink">可能重复的账目</h2>
          <p className="mt-1 text-helper-relaxed text-muted">
            只比较来源 B 与目标 A 之间的记录，A 内部或 B 内部不会互相判定为重复。逐组选择将在下一步实现；本页仅展示候选。
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {preview.duplicateGroups.map((group, index) => (
              <DuplicateGroupView key={group.id} group={group} index={index} total={preview.duplicateGroups.length} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5">
        <p className="text-body-relaxed text-muted">
          预览阶段结束。真正写入、逐组冲突选择、失败恢复和来源账本保留/删除将在后续阶段实现；现在没有数据被修改。
        </p>
        <Button variant="secondary" onClick={onClear}>
          重新选择来源和目标
        </Button>
      </div>
    </section>
  );
}

function SummaryRow({ label, value }: { readonly label: string; readonly value: string }): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

function TaxonomyView({ preview }: { readonly preview: ImportPreview }): React.JSX.Element {
  const { mapping } = preview;
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <h2 className="text-section-title font-semibold text-ink">分类 / 支付方式 / 标签</h2>
      <div className="mt-3 flex flex-col gap-2 text-body">
        <SummaryRow
          label="分类"
          value={`复用 ${String(mapping.counts.categories.reuse)} · 新建 ${String(mapping.counts.categories.create)} · 需确认 ${String(mapping.counts.categories.conflict)}`}
        />
        <SummaryRow
          label="支付方式"
          value={`复用 ${String(mapping.counts.paymentMethods.reuse)} · 新建 ${String(mapping.counts.paymentMethods.create)} · 需确认 ${String(mapping.counts.paymentMethods.conflict)}`}
        />
        <SummaryRow
          label="标签"
          value={`复用 ${String(mapping.counts.tags.reuse)} · 新建 ${String(mapping.counts.tags.create)} · 需确认 ${String(mapping.counts.tags.conflict)}`}
        />
      </div>
      {mapping.conflicts.length === 0 ? (
        <p className="mt-3 text-helper-relaxed text-muted">没有同名但属性不同的对象。</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {mapping.conflicts.map((conflict) => (
            <ConflictRow key={`${conflict.type}:${conflict.sourceId}`} conflict={conflict} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConflictRow({ conflict }: { readonly conflict: TaxonomyConflict }): React.JSX.Element {
  return (
    <li className="rounded-field bg-canvas px-4 py-3 text-sm text-ink">
      <p className="font-medium">
        {taxonomyLabel(conflict.type)}「{conflict.sourceName}」与目标「{conflict.targetName}」同名但属性不同
      </p>
      <p className="mt-1 text-muted">{conflict.message}</p>
      <p className="mt-1 text-helper text-muted">
        暂按“复用目标对象”估算重复项；真正导入前需要选择复用目标或新建保留来源属性的对象。
      </p>
    </li>
  );
}

function DuplicateGroupView({
  group,
  index,
  total,
}: {
  readonly group: DuplicateGroup;
  readonly index: number;
  readonly total: number;
}): React.JSX.Element {
  return (
    <article className="rounded-field border border-line bg-canvas p-4">
      <h3 className="text-body font-semibold text-ink">
        重复账目核对（预览）· {index + 1} / {total}
      </h3>
      <p className="mt-1 text-helper text-muted">
        来源 {String(group.sourceCount)} 条 · 目标 {String(group.targetCount)} 条。真正导入前会逐组选择保留哪一边。
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {group.records.map((record) => (
          <li
            key={`${record.side}:${record.transaction.id}`}
            className="rounded-field bg-surface px-3 py-2 text-sm"
          >
            <p className="font-medium text-ink">
              {record.side === "source" ? "来源 B" : "目标 A"} ·{" "}
              {record.transaction.kind === "expense" ? "支出" : "收入"}{" "}
              {formatMoney(record.transaction.amountCents, record.transaction.currency)}
            </p>
            <p className="mt-1 text-muted">
              {record.transaction.occurredLocalDate} · {formatTimeWithZone(record.transaction.occurredAt, record.transaction.occurredTz)} ·{" "}
              {record.categoryLabel}
              {record.transaction.paymentMethodName === null ? "" : ` · ${record.transaction.paymentMethodName}`}
            </p>
            {record.tagLabels.length === 0 ? null : (
              <p className="mt-1 text-helper text-muted">标签：{record.tagLabels.join("、")}</p>
            )}
            {record.transaction.note === null || record.transaction.note === "" ? null : (
              <p className="mt-1 text-helper text-muted">备注：{record.transaction.note}</p>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

function taxonomyLabel(type: TaxonomyConflict["type"]): string {
  switch (type) {
    case "category":
      return "分类";
    case "paymentMethod":
      return "支付方式";
    case "tag":
      return "标签";
  }
}
