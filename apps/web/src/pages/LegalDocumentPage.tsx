import { useParams } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { useI18n } from "../i18n/index.js";
import { legalDocumentById } from "@libellum/shared";

/**
 * A public legal-document page.
 *
 * It is intentionally outside `RequireAuth`: a document that must be accepted before registration
 * cannot be locked behind login. Test-only documents are visible only in development builds; a
 * production build with no reviewed legal documents simply has no such route content.
 *
 * ⚠️ **S16：页面框架随界面语言变化，协议的标题与正文不翻译。** 用户同意的是中文原文（内容哈希即中文
 * 版本），英文界面照样显示中文正文，并在正文前说明以中文版本为准、英文译本待专业审核（S16-G-10）。
 */
export function LegalDocumentPage(): React.JSX.Element {
  const { documentId } = useParams<{ readonly documentId: string }>();
  const { t, locale } = useI18n();
  const includeTest = import.meta.env.DEV;
  const document = documentId === undefined ? null : legalDocumentById(documentId, includeTest);

  if (document === null) {
    return (
      <InnerPage title={t("legal.document.fallbackTitle")} subtitle={t("legal.document.unavailable")} backTo="/">
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">
          {t("legal.document.notFound")}
        </p>
      </InnerPage>
    );
  }

  return (
    <InnerPage title={document.title} subtitle={document.version} backTo="/">
      {document.testOnly ? (
        <p className="rounded-field bg-brand-soft px-4 py-3 text-helper-relaxed text-brand-dark">
          {t("legal.document.testOnly")}
        </p>
      ) : null}

      {locale === "zh-CN" ? null : (
        <p className="rounded-field border border-line bg-surface px-4 py-3 text-helper-relaxed text-muted">
          {t("legal.chineseOnly")}
        </p>
      )}

      {/** 正文：中文原文，`lang` 让读屏软件按中文朗读。 */}
      <article
        lang="zh-CN"
        className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 text-body-relaxed text-ink"
      >
        {document.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </article>

      <p className="break-words text-helper text-muted">
        {t("legal.document.meta", { id: document.id, version: document.version })}
      </p>
    </InnerPage>
  );
}
