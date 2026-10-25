import type { Transaction } from "@libellum/shared";
import { useEffect, useMemo, useState } from "react";

import { Button } from "./Button.js";
import { t, useI18n } from "../i18n/index.js";
import { ApiRequestError, errorMessage } from "../lib/api.js";
import { formatMoney } from "../lib/format.js";
import { displayCategoryName, displayPaymentMethodName } from "../lib/presetNames.js";
import { fieldLabel, mergeEntries, type AutomaticPick, type MergeField } from "../lib/offline/merge.js";
import { applyConflictChoices, conflictQuestions } from "../lib/offline/conflictChoices.js";
import { logOffline } from "../lib/offline/diagnostics.js";
import type { ConflictRecord } from "../lib/offline/localLedger.js";

/**
 * The screen where the user settles a conflict.
 *
 * ⚠️ **The owner set both halves of this rule up front**: "先自动合并：不冲突的字段自动合，只有冲突的字段才问"
 * and **"但'自动合了哪些'必须显示出来，否则用户不知道机器替他决定了什么."**
 *
 * **The second half is the part that is easy to leave out and expensive to omit.**
 *
 * A screen that only asks about the conflicting fields looks like the program did the rest *by guessing*. **The
 * user cannot tell "it merged four fields for me" from "it dropped three of my edits"** — both look like a form
 * with one question and a Save button. So the automatic decisions are listed explicitly, with the side each value
 * came from, **and nothing is applied until the user confirms.**
 *
 * ⚠️ **Nothing here writes.** It reports the outcome; the caller decides what to do with it — which keeps this
 * screen testable as a pure description of a merge.
 */

interface ConflictScreenProps {
  readonly conflict: ConflictRecord;
  /** Called with the settled entry when the user accepts the result. */
  readonly onResolve: (settled: Transaction) => void | Promise<void>;
  /** Called when the user would rather do this later. */
  readonly onLater: () => void;
  /**
   * ⚠️ **Names for the ids, because a conflict about `01a128…` is a conflict nobody can answer.**
   *
   * The owner's report: "在冲突页面，分类并不会显示成文字，而是一串代码." **The entry carries the category name, but a
   * conflict value is a bare id from the server** — so the screen has to be told what the ids are called.
   */
  readonly categories?: readonly { readonly id: string; readonly name: string }[] | undefined;
  readonly paymentMethods?: readonly { readonly id: string; readonly name: string }[] | undefined;
  readonly tags?: readonly { readonly id: string; readonly name: string; readonly color?: string }[] | undefined;
}

/** The names a value can be looked up by, when it is an id. */
interface Names {
  /** ⚠️ `| undefined` is explicit because `exactOptionalPropertyTypes` is on, and the props are optional. */
  readonly categories?: readonly { readonly id: string; readonly name: string }[] | undefined;
  readonly paymentMethods?: readonly { readonly id: string; readonly name: string }[] | undefined;
  readonly tags?: readonly { readonly id: string; readonly name: string }[] | undefined;
}

/**
 * How a value is shown. Amounts are money, ids become names, everything else prints itself.
 *
 * S16: only the words *around* the data are translated (`（空）`, 收入/支出). Notes and user-made names print as
 * stored; preset category / payment-method names go through the display helpers, which leave renamed ones alone.
 * 金额按这笔账自己的币种格式化（`currency` 由调用方按来源传入；以前固定按人民币显示）。
 */
function describe(field: MergeField, value: unknown, names: Names, currency: string): string {
  if (field === "amountCents") return formatMoney(Number(value), currency);

  if (field === "kind") return value === "income" ? t("common.kind.income") : t("common.kind.expense");

  if (field === "note") return value === null || value === "" ? t("offline.conflict.empty") : String(value);

  if (field === "currency") return String(value);

  /**
   * ⚠️ **An id is shown as its name, and as the id only when the name is unknown.**
   *
   * The owner's report: "在冲突页面，分类并不会显示成文字，而是一串代码." **A conflict about `01a128…` is a conflict
   * nobody can answer.** Falling back to the raw string keeps the screen honest about something the ledger does not
   * list, **rather than showing an empty choice or inventing a label.**
   */
  if (field === "categoryId") {
    const name = names.categories?.find((item) => item.id === value)?.name;
    return name === undefined ? String(value) : displayCategoryName(name);
  }

  if (field === "paymentMethodId") {
    if (value === null) return t("offline.conflict.none");

    const name = names.paymentMethods?.find((item) => item.id === value)?.name;
    return name === undefined ? String(value) : displayPaymentMethodName(name);
  }

  if (field === "tags") {
    const ids = Array.isArray(value) ? (value as string[]) : [];

    if (ids.length === 0) return t("offline.conflict.noTags");

    return ids
      .map((id) => names.tags?.find((item) => item.id === id)?.name ?? id)
      .join(t("offline.conflict.tagSeparator"));
  }

  return value === null || value === undefined ? t("offline.conflict.empty") : String(value);
}

/** The side a field came from, in words. */
function sideLabel(from: "mine" | "theirs"): string {
  return from === "mine" ? t("offline.conflict.fromMine") : t("offline.conflict.fromTheirs");
}

export function ConflictScreen({ conflict, onResolve, onLater, categories, paymentMethods, tags }: ConflictScreenProps): React.JSX.Element {
  /**
   * ⚠️ S16：`locale` 在依赖里——合并结果与问题里带着字段名、选项名，切换语言后要重新生成。
   * 合并本身（哪个字段取哪一边）与语言无关，重新计算得到的是同一个结果。
   */
  const { locale } = useI18n();
  const merged = useMemo(
    () => mergeEntries(conflict.base, conflict.mine, conflict.theirs),
    [conflict.base, conflict.mine, conflict.theirs, locale],
  );

  /**
   * ⚠️ **Every conflict starts unanswered, and an unanswered one keeps the server's value.** Defaulting to
   * "mine" would make the common case — tapping through quickly — silently overwrite the other device, which is
   * the exact outcome this screen exists to prevent.
   */
  const [answers, setAnswers] = useState<ReadonlyMap<MergeField, unknown>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questions = useMemo(() => conflictQuestions(conflict), [conflict, locale]);
  const settled = useMemo(() => applyConflictChoices(merged.merged, answers,
    { categories, paymentMethods, tags }, [conflict.mine, conflict.theirs]),
    [merged.merged, answers, categories, paymentMethods, tags, conflict.mine, conflict.theirs]);
  const unanswered = questions.filter(field => !answers.has(field.field)).length;
  useEffect(() => {
    void logOffline("DIAGNOSTIC:conflict-screen", JSON.stringify({ id: conflict.mine.id.slice(0, 8),
      serverFields: conflict.fields?.map(field => field.field),
      questions: questions.map(question => ({ field: question.field, options: question.options.length })) }));
  }, [conflict, questions]);

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
        <p className="text-body-relaxed text-muted">{t("offline.conflict.intro")}</p>

        {/*
          ⚠️ **The automatic part is shown first, before any question is asked.**

          Putting the questions first and the decisions in a footnote would make the merge feel like a black box
          that occasionally interrupts. **The user should see what the program already settled before being asked
          to settle anything themselves** — and if one of those decisions looks wrong, that is information they
          need before answering the rest.
        */}
        {merged.automatic.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-helper text-muted">
              {t("offline.conflict.autoTitle", { count: merged.automatic.length })}
            </h2>

            <ul className="overflow-hidden rounded-card border border-line bg-surface">
              {merged.automatic.map((pick: AutomaticPick) => (
                <li
                  key={pick.field}
                  className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 text-sm last:border-b-0"
                >
                  <span className="shrink-0 text-muted">{fieldLabel(pick.field)}</span>
                  <span className="min-w-0 text-right [overflow-wrap:anywhere]">
                    <span className="text-ink">{describe(pick.field, pick.value, { categories, paymentMethods, tags }, pick.from === "mine" ? conflict.mine.currency : conflict.theirs.currency)}</span>
                    {/*
                      ⚠️ **Which side it came from is the point.** "金额 → ¥25.00" without "用你的" leaves the user
                      unable to tell whether their edit survived — **and that question is the whole reason this
                      list exists.**
                    */}
                    {/* 来源说明作为一个整体换行（英文 “Kept the server’s” 不拆成两行）。 */}
                    <span className="ml-2 inline-block whitespace-nowrap text-helper text-muted">{sideLabel(pick.from)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-helper text-muted">{t("offline.conflict.noAuto")}</p>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-helper text-muted">{t("offline.conflict.questionsTitle", { count: questions.length })}</h2>

          {questions.map((field) => {
            const chosen = answers.get(field.field);
            const options = field.options;

            return (
              <div key={field.field} className="rounded-card border border-line bg-surface px-4 py-3">
                <p className="text-body text-ink">{fieldLabel(field.field)}</p>

                <div className="mt-2 flex flex-col gap-2">
                  {options.map((option, index) => (
                    <button
                      key={index}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        const next = new Map(answers);
                        next.set(field.field, option.value);
                        setAnswers(next);
                      }}
                      aria-pressed={answers.has(field.field) && JSON.stringify(chosen) === JSON.stringify(option.value)}
                      className={`flex items-baseline justify-between gap-3 rounded-field border px-3 py-2 text-left text-sm transition ${
                        answers.has(field.field) && JSON.stringify(chosen) === JSON.stringify(option.value)
                          ? "border-brand bg-brand-soft text-ink"
                          : "border-line bg-canvas text-muted hover:border-brand"
                      }`}
                    >
                      <span className="shrink-0 text-xs">{option.label}</span>
                      <span
                        className={`min-w-0 text-right [overflow-wrap:anywhere] ${
                          answers.has(field.field) && JSON.stringify(chosen) === JSON.stringify(option.value) ? "text-ink" : ""
                        }`}
                      >
                        {describe(field.field, option.value, { categories, paymentMethods, tags }, option.currency ?? merged.merged.currency)}
                      </span>
                    </button>
                  ))}
                </div>

                {/*
                  ⚠️ **A default is stated rather than hidden.** Leaving a field unanswered keeps the server's
                  value, and the user is told so instead of discovering it in the result.
                */}
                {chosen === undefined ? (
                  <p className="mt-2 text-helper text-muted">{t("offline.conflict.defaultHint")}</p>
                ) : null}
              </div>
            );
          })}
        </section>

        <section className="flex flex-col gap-2">
          {questions.length === 0 ? <p className="text-body text-muted">{t("offline.conflict.noQuestions")}</p> : null}
          {error !== null ? <p role="alert" className="text-sm">{error}</p> : null}
          <Button
            disabled={unanswered > 0 || saving}
            onClick={() => {
              setSaving(true);
              setError(null);
              /**
               * 失败原因来自 `resolveConflict`（`lib/offline/write.ts`），抛出时已按当前语言生成；
               * 服务器错误按错误码本地化（`errorMessage`），其它异常没有可读原因时给通用说明。
               */
              void Promise.resolve().then(() => onResolve(settled)).catch((cause: unknown) => {
                setError(
                  cause instanceof ApiRequestError
                    ? errorMessage(cause)
                    : cause instanceof Error
                      ? cause.message
                      : t("offline.conflict.saveFailed"),
                );
              }).finally(() => setSaving(false));
            }}
          >
            {saving
              ? t("offline.conflict.saving")
              : unanswered > 0
                ? t("offline.conflict.unanswered", { count: unanswered })
                : t("offline.conflict.save")}
          </Button>

          <Button
            variant="ghost"
            onClick={() => {
              onLater();
            }}
          >
            {t("offline.conflict.later")}
          </Button>

          <p className="text-helper-relaxed text-muted">{t("offline.conflict.footer")}</p>
      </section>
    </div>
  );
}
