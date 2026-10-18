import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { Alert } from "../components/Alert.js";
import { AuthLayout } from "../components/AuthLayout.js";
import { BrandMark } from "../components/BrandMark.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { clearGuestData } from "../lib/guest/cleanup.js";
import {
  createGuestIdentity,
  isGuestPath,
  readGuestIdentity,
  updateGuestIdentity,
  type GuestIdentity,
} from "../lib/guest/identity.js";
import { ensureGuestWorkspace, type GuestWorkspaceState } from "../lib/guest/ledger.js";

const NOTICE_TEXT = "游客数据仅保存在当前设备。清除浏览器数据或更换设备后，可能无法找回。";
const WELCOME_DURATION_MS = 1400;

/**
 * The guest workspace — S14-B.
 *
 * ⚠️ **What this page is: a real local identity and an empty local ledger.** What it is not: a
 * bookkeeping system. S14-B creates the identity, the persistent local ledger registry, and the
 * switching/cleanup surfaces; recording, categories, analysis and export arrive in S14-C.
 * **No sample transactions exist anywhere on this page** — a screen full of invented numbers would
 * be indistinguishable from a working feature and would make the next stage look done.
 *
 * ⚠️ **The identity lives in `localStorage`; all guest data lives in the separate `libellum-guest`
 * database.** That separation is what lets this page promise — and enforce — that switching to a
 * formal account, logging out, or clearing guest data cannot touch a formal account's offline copy
 * (see `lib/guest/storage.ts` and `lib/guest/cleanup.ts`).
 *
 * ⚠️ **The welcome transition plays once, ever.** `welcomePending` is persisted on the identity and
 * cleared on the first mount; a reload, a reopened browser, or coming back from a formal account
 * therefore cannot replay it. `prefers-reduced-motion` removes it entirely (CSS).
 */
export function GuestWorkspacePage(): React.JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [identity, setIdentity] = useState<GuestIdentity | null>(() => readGuestIdentity());
  const [workspace, setWorkspace] = useState<GuestWorkspaceState | null>(null);
  const [workspaceError, setWorkspaceError] = useState(false);
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(
    () => readGuestIdentity()?.noticeAcknowledged ?? false,
  );
  const [welcome, setWelcome] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  /**
   * A direct visit to `/guest` (bookmark, restored tab) may arrive before any identity exists.
   * The guest entry links create one before navigating, so this is the fallback path — and it is
   * synchronous storage, so no login screen is ever shown first.
   */
  useEffect(() => {
    if (user || identity !== null) return;

    const created = createGuestIdentity();
    if (created === null) {
      setStorageError(true);
      return;
    }
    setIdentity(created);
  }, [identity, user]);

  /** Open (or create) the guest's local ledger registry. */
  useEffect(() => {
    if (user || identity === null) return;

    let cancelled = false;
    setWorkspaceError(false);

    void ensureGuestWorkspace(identity.id).then((state) => {
      if (cancelled) return;

      if (state === null) {
        setWorkspaceError(true);
        return;
      }

      setWorkspace(state);

      if (identity.welcomePending) {
        setWelcome(true);
        // Persisted before the animation ends: a refresh mid-animation must not replay it.
        updateGuestIdentity({ welcomePending: false });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [identity, user, workspaceReload]);

  /** Remember the guest page so reopening guest mode resumes here rather than at a welcome. */
  useEffect(() => {
    if (user || identity === null) return;

    const currentPath = `${location.pathname}${location.search}`;
    if (!isGuestPath(currentPath)) return;
    if (identity.lastPath === currentPath) return;

    updateGuestIdentity({ lastPath: currentPath });
  }, [identity, location.pathname, location.search, user]);

  useEffect(() => {
    if (!welcome) return;
    const timer = window.setTimeout(() => {
      setWelcome(false);
    }, WELCOME_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [welcome]);

  if (user) return <Navigate to="/" replace />;

  if (storageError) {
    return (
      <AuthLayout title="游客模式" subtitle="这台浏览器没有允许保存游客身份。" guestEntry={false}>
        <Alert>
          无法在当前浏览器中保存游客身份。请检查是否处于隐私模式、是否禁用了网站数据，然后再试一次。
        </Alert>
        <Button
          type="button"
          onClick={() => {
            void navigate("/login");
          }}
        >
          返回登录
        </Button>
      </AuthLayout>
    );
  }

  if (identity === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-canvas text-body text-muted">
        正在准备游客空间…
      </main>
    );
  }

  const ledger =
    workspace === null
      ? null
      : (workspace.ledgers.find((entry) => entry.id === workspace.currentLedgerId) ??
        workspace.ledgers[0] ??
        null);

  async function confirmClear(): Promise<void> {
    setClearing(true);
    setClearError(null);
    try {
      const result = await clearGuestData();
      if (!result.identityCleared) {
        setClearError("没能删除这台设备上的游客身份，请稍后重试。");
        return;
      }
      setClearOpen(false);
      void navigate("/login", { replace: true });
    } finally {
      setClearing(false);
    }
  }

  return (
    <main className="min-h-dvh bg-canvas">
      {welcome ? (
        <div className="guest-welcome flex items-center justify-center" aria-hidden="true">
          <div className="flex flex-col items-center gap-3 text-white">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-white/15">
              <BrandMark className="size-8" />
            </span>
            <p className="text-2xl font-semibold tracking-tight">Libevra</p>
            <p className="text-body text-white/85">游客模式 · 本地账本已准备好</p>
          </div>
        </div>
      ) : null}

      <header className="bg-brand text-white">
        <div className="mx-auto w-full max-w-md px-6 pt-12 pb-14">
          <div className="flex items-center gap-2 text-helper text-white/85">
            <BrandMark className="size-5" />
            <span>Libevra</span>
            <span className="ml-1 rounded-full bg-white/15 px-2 py-0.5 text-white">游客模式</span>
          </div>
          <h1 className="mt-5 text-[1.75rem] leading-tight font-semibold tracking-tight">
            我的本地账本
          </h1>
          <p className="mt-2 text-body-relaxed text-white/85">
            不需要账号。这本账本只在这台设备上，属于这个浏览器里的游客身份。
          </p>
          <p className="mt-1 text-helper text-white/65">本机游客身份 · {identity.id.slice(0, 8)}</p>
        </div>
      </header>

      <div className="mx-auto -mt-7 flex w-full max-w-md flex-col gap-4 px-5 pb-12">
        {workspaceError ? (
          <section className="flex flex-col gap-3">
            <Alert>
              本地账本暂时打不开。数据可能还没有准备好；可以重新尝试，或返回正式账号入口。
            </Alert>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setWorkspace(null);
                setWorkspaceReload((current) => current + 1);
              }}
            >
              重试
            </Button>
          </section>
        ) : null}

        {noticeAcknowledged ? null : (
          <section
            role="status"
            className="rounded-field border border-brand/25 bg-brand-soft/70 px-4 py-3"
          >
            <p className="text-helper-relaxed text-brand-dark">{NOTICE_TEXT}</p>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  updateGuestIdentity({ noticeAcknowledged: true });
                  setNoticeAcknowledged(true);
                }}
                className="min-h-9 rounded-field px-3 text-helper text-brand-dark transition hover:bg-white/60 focus-visible:ring-4 focus-visible:ring-brand-soft focus-visible:outline-none"
              >
                知道了
              </button>
            </div>
          </section>
        )}

        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-helper text-muted">本地账本 · 仅本机</p>
              <h2 className="mt-1 truncate text-page-title text-ink">
                {ledger === null ? "正在打开本地账本…" : ledger.name}
              </h2>
              {ledger === null ? null : (
                <p className="mt-1 text-helper text-muted">
                  创建于 {formatDate(ledger.createdAt)} · {ledger.currency}
                </p>
              )}
            </div>
            <span className="shrink-0 rounded-full bg-brand-soft px-3 py-1 text-helper text-brand-dark">
              游客
            </span>
          </div>

          <div className="mt-5 rounded-field border border-dashed border-line bg-canvas px-4 py-5 text-center">
            <p className="text-body text-ink">本地账本已经准备好。</p>
            <p className="mt-1 text-helper-relaxed text-muted">
              这里还没有任何账目。记账、分类与分析会在下一阶段接入，现在不会显示假数据。
            </p>
            <div className="mt-4">
              <Button type="button" disabled>
                记一笔（即将开放）
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-card-title text-ink">正式账号</h2>
          <p className="mt-1.5 text-helper-relaxed text-muted">
            登录或创建正式账号不会上传、覆盖或删除游客数据；游客数据也不会进入正式账号的离线缓存和同步队列。
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigate("/login");
              }}
            >
              登录已有账号
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void navigate("/register");
              }}
            >
              创建正式账号
            </Button>
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="text-card-title text-ink">清理游客数据</h2>
          <p className="mt-1.5 text-helper-relaxed text-muted">
            只删除这台设备上的游客身份与本地账本，不影响同一浏览器中的正式账号数据。
          </p>
          {clearError === null ? null : (
            <p role="alert" className="mt-2 text-helper-relaxed text-danger">
              {clearError}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setClearError(null);
              setClearOpen(true);
            }}
            className="mt-3 min-h-10 rounded-field px-3 text-button text-danger transition hover:bg-danger-soft focus-visible:ring-4 focus-visible:ring-brand-soft focus-visible:outline-none"
          >
            清理游客数据…
          </button>
        </section>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="清理游客数据？"
        description="这会删除这个浏览器里的游客身份与本地账本。当前版本没有云端备份，删除后无法找回。"
        consequences={[
          "游客身份与本地账本会从这台设备删除",
          "同一浏览器里的正式账号登录状态与离线数据不受影响",
          "删除后再次进入游客模式会得到一个新的空账本",
        ]}
        confirmLabel="清理游客数据"
        busy={clearing}
        onCancel={() => {
          if (!clearing) setClearOpen(false);
        }}
        onConfirm={() => {
          void confirmClear();
        }}
      />
    </main>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "未知日期";

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
