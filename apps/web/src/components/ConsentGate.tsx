import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "./Button.js";
import { useAuth } from "../auth/AuthProvider.js";
import {
  acceptAgreement,
  acknowledgeMajorAnnouncement,
  fetchAccountExport,
  fetchConsentStatus,
  type ConsentStatus,
  type MajorAnnouncementView,
  type RequiredLegalDocument,
} from "../lib/consent.js";
import { deliverFile } from "../lib/share.js";
import { errorMessage } from "../lib/api.js";

/** Pages where a gentle announcement must not interrupt an active input flow. */
function isInputFlow(pathname: string): boolean {
  return (
    pathname === "/add" ||
    pathname === "/record" ||
    pathname === "/scan" ||
    pathname === "/voice/review" ||
    pathname.startsWith("/transactions/")
  );
}

function isPublicLegalPage(pathname: string): boolean {
  return pathname.startsWith("/legal/");
}

/**
 * The application-wide consent and major-announcement gate.
 *
 * ⚠️ **This is a UX surface, not the authorization boundary.** The API independently refuses
 * business routes with `agreement_required`; a client that hides the dialog cannot bypass it.
 *
 * ⚠️ **Offline is fail-open.** If the status request cannot reach the server, the app continues with
 * its local data. The server remains the final judge when a write is attempted. Blocking the app
 * because a network request failed would make the offline-first program unusable in the exact
 * situation it exists for.
 */
export function ConsentGate({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const userId = user?.id ?? null;

  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [mode, setMode] = useState<"agreement" | "data-help">("agreement");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (userId === null) {
      setStatus(null);
      return;
    }

    try {
      const next = await fetchConsentStatus();
      setStatus(next);
      setMode("agreement");
      setChecked(false);
      setError(null);
    } catch {
      // Fail open offline/transient failure; the server still enforces.
      setStatus(null);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentDocument: RequiredLegalDocument | undefined = status?.requiredDocuments.find(
    (document) => !document.accepted,
  );
  const missing = (status?.missingDocumentIds.length ?? 0) > 0;
  const pendingMajor = status?.majorAnnouncement ?? null;
  const legalPage = isPublicLegalPage(location.pathname);
  const safeForMajor = !isInputFlow(location.pathname);

  async function onAccept(): Promise<void> {
    if (currentDocument === undefined || !checked) return;
    setBusy(true);
    setError(null);
    try {
      await acceptAgreement(currentDocument);
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onAckMajor(action: "acknowledged" | "opened_details" | "dismissed"): Promise<void> {
    if (pendingMajor === null) return;
    setBusy(true);
    setError(null);
    try {
      await acknowledgeMajorAnnouncement(pendingMajor, action);
      setStatus((current) => (current === null ? current : { ...current, majorAnnouncement: null }));
      if (action === "opened_details") {
        void navigate(`/update/announcements/${pendingMajor.version}`);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onExport(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const file = await fetchAccountExport();
      const outcome = await deliverFile(file.fileName, "application/json", file.bytes);
      setNotice(
        outcome.cancelled
          ? "已取消导出。"
          : "账号数据已导出。文件包含账号资料和当前可访问账本的全部账目。",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onLogout(): Promise<void> {
    await logout({ preserveOfflineData: true });
  }

  if (user === null || legalPage || status === null) {
    return <>{children}</>;
  }

  const showAgreement = missing && currentDocument !== undefined && mode === "agreement";
  const showMajor = !missing && pendingMajor !== null && safeForMajor;

  if (!showAgreement && !showMajor && mode !== "data-help") {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-overlay-soft p-3 backdrop-in sm:items-center">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="consent-dialog-title"
          className="max-h-[calc(100dvh-24px)] w-full max-w-md overflow-y-auto rounded-t-sheet border border-line bg-surface p-5 shadow-sheet sm:rounded-card"
        >
          {mode === "data-help" ? (
            <AccountDataHelp
              busy={busy}
              notice={notice}
              error={error}
              onBack={() => {
                setMode("agreement");
                setNotice(null);
                setError(null);
              }}
              onExport={() => void onExport()}
              onLogout={() => void onLogout()}
            />
          ) : showAgreement ? (
            <>
              <p className="text-helper text-muted">
                {currentDocument.version ? `文件版本 ${currentDocument.version}` : null}
              </p>
              <h2 id="consent-dialog-title" className="mt-1 text-page-title text-ink">
                {currentDocument.title}
              </h2>
              <p className="mt-3 text-body-relaxed text-ink">{currentDocument.summary}</p>

              <a
                href={`/legal/${currentDocument.id}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-body font-medium text-brand hover:underline"
              >
                查看完整文件
              </a>

              {error === null ? null : (
                <p role="alert" className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-helper-relaxed text-danger">
                  {error}
                </p>
              )}

              <label className="mt-5 flex items-start gap-3 rounded-field border border-line p-3 text-body text-ink">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setChecked(event.target.checked);
                  }}
                  className="mt-1 size-4 shrink-0"
                />
                <span>我已阅读并同意这份文件。</span>
              </label>

              <div className="mt-4 flex flex-col gap-2">
                <Button onClick={() => void onAccept()} disabled={!checked || busy}>
                  {busy ? "处理中…" : "同意并继续"}
                </Button>
                <Button variant="secondary" onClick={() => setMode("data-help")} disabled={busy}>
                  暂不同意
                </Button>
              </div>
            </>
          ) : (
            <MajorAnnouncementCard
              announcement={pendingMajor!}
              busy={busy}
              error={error}
              onAck={(action) => void onAckMajor(action)}
            />
          )}
        </section>
      </div>
    </>
  );
}

function MajorAnnouncementCard({
  announcement,
  busy,
  error,
  onAck,
}: {
  readonly announcement: MajorAnnouncementView;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onAck: (action: "acknowledged" | "opened_details" | "dismissed") => void;
}): React.JSX.Element {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-helper text-muted">重要更新 · {announcement.version}</p>
          <h2 id="consent-dialog-title" className="mt-1 text-page-title text-ink">
            {announcement.title}
          </h2>
        </div>
        <button
          type="button"
          aria-label="关闭重要更新"
          disabled={busy}
          onClick={() => onAck("dismissed")}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted outline-none transition hover:bg-canvas hover:text-ink focus-visible:ring-4 focus-visible:ring-brand-soft"
        >
          ×
        </button>
      </div>

      <p className="mt-3 text-body-relaxed text-ink">{announcement.summary}</p>

      {announcement.sections.map((section) => (
        <div key={section.heading} className="mt-4">
          <h3 className="text-sm font-semibold text-ink">{section.heading}</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-helper-relaxed text-muted marker:text-brand">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}

      {error === null ? null : (
        <p role="alert" className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-helper-relaxed text-danger">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <Button onClick={() => onAck("acknowledged")} disabled={busy}>
          {busy ? "处理中…" : "知道了"}
        </Button>
        <Button variant="secondary" onClick={() => onAck("opened_details")} disabled={busy}>
          查看详情
        </Button>
      </div>
    </>
  );
}

function AccountDataHelp({
  busy,
  notice,
  error,
  onBack,
  onExport,
  onLogout,
}: {
  readonly busy: boolean;
  readonly notice: string | null;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onExport: () => void;
  readonly onLogout: () => void;
}): React.JSX.Element {
  return (
    <>
      <h2 id="consent-dialog-title" className="text-page-title text-ink">
        如果你暂时不同意
      </h2>
      <p className="mt-2 text-body-relaxed text-muted">
        你可以先导出或处理账号中的数据，也可以退出登录，稍后再决定。
      </p>

      {notice === null ? null : <p className="mt-3 rounded-field bg-brand-soft px-3 py-2 text-helper-relaxed text-brand-dark">{notice}</p>}
      {error === null ? null : (
        <p role="alert" className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-helper-relaxed text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <Button variant="secondary" onClick={onExport} disabled={busy}>
          {busy ? "处理中…" : "导出我的数据"}
        </Button>
        <details className="rounded-field border border-line px-3 py-2.5 text-helper-relaxed text-muted">
          <summary className="cursor-pointer font-medium text-ink">
            删除服务器储存的数据（暂不执行）
          </summary>
          <p className="mt-1">
            这个入口需要先确定共享账本、历史记录和备份的保留范围；目前不会执行删除，也不会伪装成已清除全部服务器数据。
          </p>
        </details>
        <details className="rounded-field border border-line px-3 py-2.5 text-helper-relaxed text-muted">
          <summary className="cursor-pointer font-medium text-ink">
            注销账号（暂不执行）
          </summary>
          <p className="mt-1">
            这是与删除数据不同的操作。现有架构还没有安全的所有权转让/级联方案，因此暂不执行不可逆注销；
            需要所有者先决定共享账本和保留数据的处理规则。
          </p>
        </details>
        <Button variant="ghost" onClick={onLogout} disabled={busy}>
          退出登录
        </Button>
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          返回协议确认
        </Button>
      </div>

      <p className="mt-4 text-helper text-muted">
        这些未执行的入口不会删除本机 IndexedDB、历史账目或未同步记录。
      </p>
      <Link to="/legal/local-test-terms" target="_blank" className="mt-3 inline-block text-helper font-medium text-brand">
        查看协议文件
      </Link>
    </>
  );
}
