import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { APP_VERSION } from "@libellum/shared";

import { Button } from "./Button.js";
import { useAuth } from "../auth/AuthProvider.js";
import { localizeMajorAnnouncement } from "../i18n/content/index.js";
import { useI18n } from "../i18n/index.js";
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
import { selectDisplayedMajorAnnouncement } from "../lib/majorAnnouncementVisibility.js";

/** Pages where a gentle announcement must not interrupt an active input/import flow. */
export function isInputFlow(pathname: string): boolean {
  return (
    pathname === "/add" ||
    pathname === "/record" ||
    pathname === "/paste" ||
    pathname === "/scan" ||
    pathname === "/voice/review" ||
    pathname === "/paste/review" ||
    pathname.startsWith("/import") ||
    pathname.endsWith("/settings/import") ||
    pathname.startsWith("/transactions/")
  );
}

function isPublicLegalPage(pathname: string): boolean {
  return pathname.startsWith("/legal/");
}

function isAccountDataPage(pathname: string): boolean {
  return pathname === "/settings/account-data";
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
  const { t, locale } = useI18n();
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
  /**
   * ⚠️ The server returns the newest unacknowledged major announcement, not necessarily one that
   * belongs to this build. After an update, an older popup must stay history; see the filter's
   * rationale. `onAckMajor` only ever receives this displayable value.
   */
  const pendingMajor = selectDisplayedMajorAnnouncement(
    status?.majorAnnouncement ?? null,
    APP_VERSION,
  );
  const legalPage = isPublicLegalPage(location.pathname);
  const accountDataPage = isAccountDataPage(location.pathname);
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
      setNotice(outcome.cancelled ? t("legal.consent.exportCancelled") : t("legal.consent.exportDone"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function onLogout(): Promise<void> {
    await logout({ preserveOfflineData: true });
  }

  if (user === null || legalPage || accountDataPage || status === null) {
    return <>{children}</>;
  }

  const showAgreement = missing && currentDocument !== undefined && mode === "agreement";
  const showMajor = !missing && pendingMajor !== null && safeForMajor;

  if (!showAgreement && !showMajor && mode !== "data-help") {
    return <>{children}</>;
  }

  /**
   * 重大公告的**内容**按当前语言显示（没有译文时原样中文）；确认 / 关闭仍用服务器下发的原对象，
   * `id` 与 `version` 不随语言变化。
   */
  const shownMajor = pendingMajor === null ? null : localizeMajorAnnouncement(pendingMajor);

  return (
    <>
      {children}

      {mode === "data-help" ? (
        <ConsentDialog
          title={t("legal.consent.help.title")}
          eyebrow={t("legal.consent.help.eyebrow")}
          footer={
            <>
              <Button variant="ghost" onClick={() => void onLogout()} disabled={busy}>
                {t("legal.consent.help.signOut")}
              </Button>
              <Button variant="secondary" onClick={() => {
                setMode("agreement");
                setNotice(null);
                setError(null);
              }} disabled={busy}>
                {t("legal.consent.help.backToAgreement")}
              </Button>
            </>
          }
        >
          <AccountDataHelp
            busy={busy}
            notice={notice}
            error={error}
            onExport={() => void onExport()}
            onOpenAccountData={() => {
              void navigate("/settings/account-data");
            }}
          />
        </ConsentDialog>
      ) : showAgreement ? (
        <ConsentDialog
          title={currentDocument.title}
          eyebrow={
            currentDocument.version
              ? t("legal.consent.documentVersion", { version: currentDocument.version })
              : undefined
          }
          footer={
            <>
              <Button onClick={() => void onAccept()} disabled={!checked || busy}>
                {busy ? t("legal.consent.processing") : t("legal.consent.accept")}
              </Button>
              <Button variant="secondary" onClick={() => setMode("data-help")} disabled={busy}>
                {t("legal.consent.decline")}
              </Button>
            </>
          }
        >
          {/**
            * ⚠️ 协议的标题、摘要与正文是用户要同意的**中文原文**（内容哈希即中文版本），不翻译；
            * 非中文界面在摘要前说明以中文版本为准（S16-G-10）。
            */}
          {locale === "zh-CN" ? null : (
            <p className="mb-3 rounded-field bg-canvas px-3 py-2 text-helper-relaxed text-muted">
              {t("legal.chineseOnly")}
            </p>
          )}
          <p lang="zh-CN" className="text-body-relaxed text-ink">
            {currentDocument.summary}
          </p>

          <a
            href={`/legal/${currentDocument.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-body font-medium text-brand hover:underline"
          >
            {t("legal.consent.viewFull")}
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
            <span>{t("legal.consent.agree")}</span>
          </label>
        </ConsentDialog>
      ) : (
        <ConsentDialog
          title={shownMajor!.title}
          eyebrow={t("legal.consent.majorEyebrow", { version: pendingMajor!.version })}
          closeAction={
            <button
              type="button"
              aria-label={t("legal.consent.closeMajor")}
              disabled={busy}
              onClick={() => void onAckMajor("dismissed")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted outline-none transition hover:bg-canvas hover:text-ink focus-visible:ring-4 focus-visible:ring-focus-ring"
            >
              ×
            </button>
          }
          footer={
            <>
              <Button onClick={() => void onAckMajor("acknowledged")} disabled={busy}>
                {busy ? t("legal.consent.processing") : t("legal.consent.gotIt")}
              </Button>
              <Button variant="secondary" onClick={() => void onAckMajor("opened_details")} disabled={busy}>
                {t("legal.consent.viewDetails")}
              </Button>
            </>
          }
        >
          <MajorAnnouncementBody announcement={shownMajor!} error={error} />
        </ConsentDialog>
      )}
    </>
  );
}

/**
 * One shared shell for all three dialogs.
 *
 * The header and footer are outside the scroll container, so the actions never move off-screen
 * when the body gets long. Height comes from one CSS class rather than three per-dialog heights;
 * `dvh` follows the iOS address bar and the media query gives very short viewports more room.
 */
export function ConsentDialog({
  title,
  eyebrow,
  closeAction,
  footer,
  onDismiss,
  children,
}: {
  readonly title: string;
  readonly eyebrow?: string | undefined;
  readonly closeAction?: React.ReactNode;
  readonly footer: React.ReactNode;
  /** When set, clicking the grey backdrop calls this (same as a cancel button). */
  readonly onDismiss?: (() => void) | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-overlay-soft backdrop-in sm:items-center sm:p-3"
      onClick={(event) => {
        /**
         * ⚠️ Only the backdrop itself dismisses. Clicks inside the sheet bubble up to this
         * container with a different target; treating every bubble as "outside" would make a
         * submit button close the dialog instead of running its action.
         */
        if (event.target === event.currentTarget && onDismiss !== undefined) {
          onDismiss();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-dialog-title"
        onClick={(event) => {
          event.stopPropagation();
        }}
        className="consent-dialog flex w-full max-w-md flex-col overflow-hidden rounded-t-sheet border border-line bg-surface shadow-sheet sheet-in sm:rounded-card"
      >

        <header className="shrink-0 border-b border-line px-5 pb-3 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {eyebrow === undefined ? null : <p className="text-helper text-muted">{eyebrow}</p>}
              <h2 id="consent-dialog-title" className="mt-1 text-page-title text-ink">
                {title}
              </h2>
            </div>
            {closeAction}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        <footer className="shrink-0 border-t border-line px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
          <div className="flex flex-col gap-2">{footer}</div>
        </footer>
      </section>
    </div>
  );
}

function MajorAnnouncementBody({
  announcement,
  error,
}: {
  readonly announcement: MajorAnnouncementView;
  readonly error: string | null;
}): React.JSX.Element {
  return (
    <>
      <p className="text-body-relaxed text-ink">{announcement.summary}</p>

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
    </>
  );
}

function AccountDataHelp({
  busy,
  notice,
  error,
  onExport,
  onOpenAccountData,
}: {
  readonly busy: boolean;
  readonly notice: string | null;
  readonly error: string | null;
  readonly onExport: () => void;
  readonly onOpenAccountData: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <p className="text-body-relaxed text-muted">{t("legal.consent.help.intro")}</p>

      {notice === null ? null : (
        <p className="mt-3 rounded-field bg-brand-soft px-3 py-2 text-helper-relaxed text-brand-dark">{notice}</p>
      )}
      {error === null ? null : (
        <p role="alert" className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-helper-relaxed text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <Button variant="secondary" onClick={onExport} disabled={busy}>
          {busy ? t("legal.consent.processing") : t("legal.consent.help.export")}
        </Button>
        <details className="rounded-field border border-line px-3 py-2.5 text-helper-relaxed text-muted">
          <summary className="cursor-pointer font-medium text-ink">{t("legal.consent.help.deleteTitle")}</summary>
          <p className="mt-1">{t("legal.consent.help.deleteBody")}</p>
        </details>
        <details className="rounded-field border border-line px-3 py-2.5 text-helper-relaxed text-muted">
          <summary className="cursor-pointer font-medium text-ink">{t("legal.consent.help.closeTitle")}</summary>
          <p className="mt-1">{t("legal.consent.help.closeBody")}</p>
        </details>
        <Button variant="secondary" onClick={onOpenAccountData} disabled={busy}>
          {t("legal.consent.help.openAccountData")}
        </Button>
      </div>

      <p className="mt-4 text-helper text-muted">{t("legal.consent.help.localNote")}</p>
      <Link to="/legal/local-test-terms" target="_blank" className="mt-3 inline-block text-helper font-medium text-brand">
        {t("legal.consent.help.viewAgreement")}
      </Link>
    </>
  );
}
