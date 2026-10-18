import { useState } from "react";
import { useNavigate } from "react-router";

import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { TabPage } from "../components/Layouts.js";
import { TabPageHeader } from "../components/TabPageHeader.js";
import { clearGuestData } from "../lib/guest/cleanup.js";
import { clearAllDeviceData } from "../lib/guest/cleanup.js";
import { readGuestIdentity } from "../lib/guest/identity.js";
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
      <TabPageHeader
        title="我的"
        subtitle="游客模式 · 本地账本，数据只保存在这台设备"
      />

      <div className="flex flex-col gap-6 px-6 py-6">
        <section className="rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="text-body font-medium text-ink">游客身份</p>
              <p className="mt-0.5 truncate text-helper text-muted">
                本机身份 · {identity?.id.slice(0, 8) ?? "未创建"}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-brand-soft px-3 py-1 text-helper text-brand-dark">
              仅本机
            </span>
          </div>
          <div className="border-t border-line px-5 py-4">
            <p className="text-helper-relaxed text-muted">
              创建或登录正式账号后，在目标账本的「设置 → 导入账本」里可以先预览、再确认导入。游客账本不会自动上传、合并或删除；
              本轮导入也不会删除正式账本里已有的任何账目。
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void navigate("/register")}
                className="w-full rounded-field bg-brand py-3 text-button font-medium text-white transition hover:bg-brand-dark"
              >
                创建正式账号
              </button>
              <button
                type="button"
                onClick={() => void navigate("/login")}
                className="w-full rounded-field border border-line py-3 text-button font-medium text-ink transition hover:bg-canvas"
              >
                登录已有账号
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-helper text-muted">账本设置</h2>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {[
              { label: "分类管理", tail: "/settings/categories" },
              { label: "支付方式", tail: "/settings/payment-methods" },
              { label: "标签", tail: "/settings/tags" },
            ].map((entry) => (
              <button
                key={entry.tail}
                type="button"
                disabled={bookId === null}
                onClick={() => {
                  if (bookId !== null) void navigate(`/books/${bookId}${entry.tail}`);
                }}
                className={settingsRow}
              >
                <span>{entry.label}</span>
                <span aria-hidden="true" className="text-muted">
                  ›
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-2 px-1 text-helper text-muted">本机数据</h2>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <button
              type="button"
              onClick={() => {
                setClearOpen(true);
              }}
              className={`${settingsRow} text-danger`}
            >
              <span>清除游客数据</span>
              <span aria-hidden="true">›</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setClearAllStage(1);
              }}
              className={`${settingsRow} text-danger`}
            >
              <span>清除此设备全部 Libevra 本地数据</span>
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <p className="mt-3 px-1 text-helper-relaxed text-muted">
            游客数据没有云端备份；清除浏览器数据或更换设备后可能无法找回。
          </p>
        </section>

        <p className="text-center text-helper text-muted">Libevra {APP_VERSION}</p>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="清除游客数据？"
        description="只删除这个浏览器里的游客身份与本地账本。正式账号的离线数据与登录状态不受影响。"
        consequences={[
          "游客身份与本地账本会从这台设备删除",
          "没有云端备份，删除后无法找回",
          "再次进入游客模式会得到一个新的空账本",
        ]}
        confirmLabel="清除游客数据"
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
        title="清除此设备全部 Libevra 本地数据？"
        description="范围包括：游客身份与本地账本、当前正式账号的离线账本副本与缓存、以及本应用注册的离线缓存。"
        consequences={[
          "这台设备上 Libevra 的所有本地数据都会被删除",
          "不会删除服务器上的账号与账目",
          "下一步还需要再确认一次",
        ]}
        confirmLabel="继续"
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
        title="最后一次确认"
        description="这一步不可撤销。删除后需要联网重新下载正式账号的账目；游客数据无法恢复。"
        consequences={[
          "游客本地账本无法恢复",
          "正式账号需要重新登录或重新下载离线数据",
          "不会影响服务器上的任何数据",
        ]}
        confirmLabel="确认清除全部本地数据"
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
