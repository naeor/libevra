import { useLocation } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";

/**
 * **隐私政策 / 使用条款 —— 页面存在，内容尚未编写。**
 *
 * ⚠️ **Why these pages exist at all, given there is nothing in them.** The owner asked for all three
 * footer items to be tappable (2026-10-13): *"把他们仨放到屏幕的最底下。并且颜色都是灰色，只是点击可以跳转."*
 * **A tappable item that goes nowhere is worse than a label**, so each gets a real route.
 *
 * ⚠️ **⚠️ And each one says plainly that the text is not written yet.** The owner attached this
 * condition to the same section earlier: *"如果尚未准备正式内容，可以先建立合理的页面和文案结构，但
 * **不要编造已经具备法律效力的条款**，也不要未经确认就宣称符合某项法规."*
 *
 * So this page is **not a stub policy and not a placeholder paragraph** — it is a page whose content is
 * the honest statement that the document does not exist, plus what it will have to cover. **Invented
 * terms would be worse than no terms**, because a reader cannot tell a drafted clause from a real one.
 *
 * ⚠️ **It lists what must be settled before launch**, drawn from what this app actually does and does
 * not do — which is the useful half of the job and the part that can be written without a lawyer.
 * **Nothing here claims compliance with any regulation**, and nothing should be added that does.
 */

/**
 * The two documents, and what each will have to cover.
 *
 * 文字在 `legal.placeholder.<kind>.*`（S16 国际化）；这里只存顺序与键，渲染时按当前语言取。
 * 这些是「待确认事项」而不是条款正文，所以可以翻译——英文同样声明它不是正式文本。
 */
const DOCUMENTS = {
  privacy: ["storage", "recognition", "logs", "exportDelete", "cookies", "thirdParty"],
  terms: ["service", "accounts", "sharing", "backup", "license", "termination"],
} as const;

export function LegalPage({ kind }: { readonly kind: keyof typeof DOCUMENTS }): React.JSX.Element {
  const location = useLocation();
  const { t } = useI18n();
  const questions: readonly string[] =
    kind === "privacy"
      ? DOCUMENTS.privacy.map((question) => t(`legal.placeholder.privacy.questions.${question}`))
      : DOCUMENTS.terms.map((question) => t(`legal.placeholder.terms.questions.${question}`));

  /**
   * ⚠️ **The same declared-origin rule as `AboutPage`**, so 返回 goes back to the start page when the
   * footer was the way in — and to 设置 when it was reached from there. **Both of these are in the
   * footer, so without this they would inherit the same bounce the owner just reported.**
   */
  const declared = (location.state as { from?: unknown } | null)?.from;
  const from = typeof declared === "string" ? declared : null;

  return (
    <InnerPage title={t(`legal.placeholder.${kind}.title`)} backTo={from ?? "/settings"}>
      <div className="flex flex-col gap-5 text-body-relaxed text-ink">
        <section className="rounded-card border border-line bg-surface p-5">
          {/**
            * ⚠️ **Said first and plainly.** Somebody who taps 隐私政策 wants to know what happens to
            * their data; the second-best answer is **an accurate statement that the document is not
            * written**, and the worst is a paragraph that looks like a policy and is not one.
            */}
          <p className="text-muted">{t(`legal.placeholder.${kind}.lede`)}</p>
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-section-title text-ink">{t("legal.placeholder.mustCover")}</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-muted">
            {questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </section>

        <p className="text-helper-relaxed text-muted">{t("legal.placeholder.pending")}</p>
      </div>
    </InnerPage>
  );
}
