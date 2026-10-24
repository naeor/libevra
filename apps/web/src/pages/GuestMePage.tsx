import { useState } from "react";
import { useNavigate } from "react-router";

import { ChevronIcon } from "../components/Icons.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { TabPage } from "../components/Layouts.js";
import { TabPageHeader } from "../components/TabPageHeader.js";
import { LOCALE_NATIVE_NAMES, useI18n } from "../i18n/index.js";
import { clearGuestData } from "../lib/guest/cleanup.js";
import { clearAllDeviceData } from "../lib/guest/cleanup.js";
import { readGuestIdentity } from "../lib/guest/identity.js";
import { useLanguagePreference } from "../lib/languageRuntime.js";
import { useLedger } from "../lib/queries.js";
import { APP_VERSION } from "../lib/version.js";

/**
 * 我的 · guest variant.
 *
 * ⚠️ **The same frame, the same list rhythm and the same dialogs as the account page** — this is
 * `/me` for a guest, not a second settings application. What differs is the content that cannot
 * exist without an account (密码、恢复码、邀请码、管理员、注销账号) versus what is genuinely local
 * (本地账本、分类管理、清理数据).
 *
 * ⚠️ **No repeated "you are a guest" messaging.** The identity is stated once in the header and in
 * a compact row; the rest of the page is actions. Switching to a formal account and the future
 * migration path live here, which is the natural place the owner asked for.
 */
export function GuestMePage(): React.JSX.Element {
  const navigate = useNavigate();
  const ledger = useLedger();
  const identity = readGuestIdentity();
  const bookId = ledger.data?.book.id ?? null;
  const [clearOpen, setClearOpen] = useState(false);
  const [clearAllStage, setClearAllStage] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const language = useLanguagePreference();

  const settingsRow =
    "flex w-full items-center justify-between gap-4 border-b border-line px-5 py-3.5 text-left text-body text-ink transition last:border-b-0 hover:bg-canvas disabled:opacity-50";

  async function handleClearGuest(): Promise<void> {
    setBusy(true);
    try {
      const result = await clearGuestData();
      if (result.identityCleared) {
        setClearOpen(false);
        void navigate("/login", { replace: true });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleClearAll(): Promise<void> {
    setBusy(true);
    try {
      await clearAllDeviceData();
      // A full reload is the honest end state: caches, the service worker and both databases are gone.
      window.location.assign("/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TabPage active="me" onNavigate={(to) => void navigate(to)} currentBookName={ledger.data?.book.name}>
      <TabPageHeader title={t("account.guestMe.title")} subtitle={t("account.guestMe.subtitle")} />

      <div className="flex flex-col gap-6 px-6 py-6">
        <section className="rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-body font-medium text-ink">{t("account.guestMe.identity")}</p>
              <p className="mt-0.5 truncate text-helper text-muted">
                {t("account.guestMe.localIdentity", {
                  id: identity?.id.slice(0, 8) ?? t("account.guestMe.notCreated"),
                })}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-brand-soft px-3 py-1 text-helper text-brand-dark">
              {t("account.guestMe.localOnly")}
            </span>
          </div>
          <div className="border-t border-line px-5 py-4">
            <p className="text-helper-relaxed text-muted">{t("account.guestMe.formalNote")}</p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void navigate("/register")}
                className="w-full rounded-field bg-brand px-3 py-3 text-button font-medium text-on-brand transition hover:bg-brand-dark"
              >
                {t("account.guestMe.createAccount")}
              </button>
              <button
                type="button"
                onClick={() => void navigate("/login")}
                className="w-full rounded-field border border-line px-3 py-3 text-button font-medium text-ink transition hover:bg-canvas"
              >
                {t("account.guestMe.signIn")}
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-5 text-helper font-medium text-muted">{t("account.guestMe.ledgerSettings")}</h2>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {(
              [
                { label: t("account.guestMe.categories"), tail: "/settings/categories" },
                { label: t("account.guestMe.paymentMethods"), tail: "/settings/payment-methods" },
                { label: t("account.guestMe.tags"), tail: "/settings/tags" },
              ] as const
            ).map((entry) => (
              <button
                key={entry.tail}
                type="button"
                disabled={bookId === null}
                onClick={() => {
                  if (bookId !== null) void navigate(`/books/${bookId}${entry.tail}`);
                }}
                className={settingsRow}
              >
                <span className="min-w-0">{entry.label}</span>
                <ChevronIcon direction="right" className="size-4 shrink-0 text-muted/70" />
              </button>
            ))}
          </div>
        </section>

        {/**
          * ⚠️ **S16：游客没有「设置」页，语言入口放在这里。** 目标就是正式账号在
          * 设置 → 显示与数据 → 语言 打开的同一页（`/settings/appearance/language`，游客可进）；
          * 行的写法与上面的账本设置行一致。标题在非英文界面附上 “Language”，
          * 切到看不懂的语言后也能找回这一行（与设置页的语言行相同）。
          */}
        <section>
          <h2 className="mb-2 px-5 text-helper font-medium text-muted">{t("account.guestMe.display")}</h2>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <button
              type="button"
              data-testid="guest-language-row"
              onClick={() => void navigate("/settings/appearance/language")}
              className={settingsRow}
            >
              <span className="min-w-0">
                {`${t("language.title")}${language.locale === "en-US" ? "" : " / Language"}`}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-helper text-muted">
                {LOCALE_NATIVE_NAMES[language.locale]}
                <ChevronIcon direction="right" className="size-4 text-muted/70" />
              </span>
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-5 text-helper font-medium text-muted">{t("account.guestMe.deviceData")}</h2>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <button
              type="button"
              onClick={() => {
                setClearOpen(true);
              }}
              className={`${settingsRow} text-danger`}
            >
              <span className="min-w-0">{t("account.guestMe.clearGuest")}</span>
              <ChevronIcon direction="right" className="size-4 shrink-0 text-danger/70" />
            </button>
            <button
              type="button"
              onClick={() => {
                setClearAllStage(1);
              }}
              className={`${settingsRow} text-danger`}
            >
              <span className="min-w-0">{t("account.guestMe.clearAll")}</span>
              <ChevronIcon direction="right" className="size-4 shrink-0 text-danger/70" />
            </button>
          </div>
          <p className="mt-3 px-1 text-helper-relaxed text-muted">{t("account.guestMe.noBackup")}</p>
        </section>

        <p className="text-center text-helper text-muted">Libevra {APP_VERSION}</p>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title={t("account.guestMe.clearGuestDialog.title")}
        description={t("account.guestMe.clearGuestDialog.description")}
        consequences={[
          t("account.guestMe.clearGuestDialog.removed"),
          t("account.guestMe.clearGuestDialog.noBackup"),
          t("account.guestMe.clearGuestDialog.fresh"),
        ]}
        confirmLabel={t("account.guestMe.clearGuestDialog.confirm")}
        busy={busy}
        onCancel={() => {
          if (!busy) setClearOpen(false);
        }}
        onConfirm={() => {
          void handleClearGuest();
        }}
      />

      <ConfirmDialog
        open={clearAllStage === 1}
        title={t("account.guestMe.clearAllDialog.title")}
        description={t("account.guestMe.clearAllDialog.description")}
        consequences={[
          t("account.guestMe.clearAllDialog.everything"),
          t("account.guestMe.clearAllDialog.serverKept"),
          t("account.guestMe.clearAllDialog.twoSteps"),
        ]}
        confirmLabel={t("account.guestMe.clearAllDialog.confirm")}
        busy={busy}
        onCancel={() => {
          if (!busy) setClearAllStage(0);
        }}
        onConfirm={() => {
          setClearAllStage(2);
        }}
      />

      <ConfirmDialog
        open={clearAllStage === 2}
        title={t("account.guestMe.finalDialog.title")}
        description={t("account.guestMe.finalDialog.description")}
        consequences={[
          t("account.guestMe.finalDialog.guestLost"),
          t("account.guestMe.finalDialog.reDownload"),
          t("account.guestMe.finalDialog.serverKept"),
        ]}
        confirmLabel={t("account.guestMe.finalDialog.confirm")}
        busy={busy}
        onCancel={() => {
          if (!busy) setClearAllStage(0);
        }}
        onConfirm={() => {
          setClearAllStage(0);
          void handleClearAll();
        }}
      />
    </TabPage>
  );
}
