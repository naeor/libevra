import { useParams } from "react-router";

import { InnerPage } from "../components/Layouts.js";
import { legalDocumentById } from "@libellum/shared";

/**
 * A public legal-document page.
 *
 * It is intentionally outside `RequireAuth`: a document that must be accepted before registration
 * cannot be locked behind login. Test-only documents are visible only in development builds; a
 * production build with no reviewed legal documents simply has no such route content.
 */
export function LegalDocumentPage(): React.JSX.Element {
  const { documentId } = useParams<{ readonly documentId: string }>();
  const includeTest = import.meta.env.DEV;
  const document = documentId === undefined ? null : legalDocumentById(documentId, includeTest);

  if (document === null) {
    return (
      <InnerPage title="协议文件" subtitle="这份文件当前不可用。" backTo="/">
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">
          找不到这份协议文件。它可能尚未发布，或者链接有误。
        </p>
      </InnerPage>
    );
  }

  return (
    <InnerPage title={document.title} subtitle={document.version} backTo="/">
      {document.testOnly ? (
        <p className="rounded-field bg-brand-soft px-4 py-3 text-helper-relaxed text-brand-dark">
          这是本地测试文件，不构成正式法律文件，仅用于验证协议确认流程。
        </p>
      ) : null}

      <article className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 text-body-relaxed text-ink">
        {document.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </article>

      <p className="text-helper text-muted">
        文件 ID：{document.id} · 版本：{document.version}
      </p>
    </InnerPage>
  );
}
