import { useCallback, useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { useNavigate } from "react-router";

import { Alert } from "../components/Alert.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { CopyButton } from "../components/CopyButton.js";
import { InnerPage } from "../components/Layouts.js";
import { SectionFrame } from "../components/SectionFrame.js";
import { EmptyState, ErrorState, SkeletonRows } from "../components/States.js";
import { TextField } from "../components/TextField.js";
import { t as translate, useI18n } from "../i18n/index.js";
import {
  createAdminInvite,
  fetchAdminAudit,
  fetchAdminInvites,
  fetchAdminOverview,
  fetchAdminRoster,
  fetchAdminSelf,
  restoreAdminUser,
  revokeAdminInvite,
  searchAdminUsers,
  suspendAdminUser,
} from "../lib/admin.js";
import { errorMessage } from "../lib/api.js";
import { formatInstant } from "../lib/datetime.js";
import type {
  AdminAuditListResponse,
  AdminInvite,
  AdminOverviewResponse,
  AdminRosterResponse,
  AdminUserSearchResponse,
} from "@libellum/shared";

/**
 * **系统管理（S13-B）**
 *
 * ⚠️ **Every screen here is a view of what the server already decided.** The pages call the
 * admin API and render the answer; they do not filter, and they do not hide data the API sent.
 * Hiding a control in the browser has never made an endpoint safe, and the reverse is also true:
 * a screen that quietly dropped a row would make the console disagree with the database.
 *
 * ⚠️ **Nothing on these screens is a ledger.** The API cannot return one, and no page asks for
 * one — *"管理员可以管理系统，不应因此默认拥有查看所有私人账本的权限"*.
 */

type Load<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly data: T };

/** One async load with a retry, so every screen behaves the same way. */
function useLoad<T>(load: () => Promise<T>): {
  readonly state: Load<T>;
  readonly reload: () => void;
} {
  const [state, setState] = useState<Load<T>>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    void load()
      .then((data) => {
        if (!cancelled) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: "error", message: errorMessage(error) });
      });

    return () => {
      cancelled = true;
    };
    // `load` is recreated on every render by callers; `tick` is the explicit refresh signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { state, reload: () => { setTick((value) => value + 1); } };
}

/**
 * **The gate.** Asks the server once; renders the page only if the answer is yes.
 *
 * ⚠️ **A refusal is silent in the sense that matters**: the console does not explain which check
 * failed (the server never says), it simply is not there. The navigation happens after the
 * answer, so a non-administrator never sees a flash of admin UI.
 */
function useAdminGate(): { readonly allowed: boolean | null } {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    void fetchAdminSelf()
      .then((self) => {
        if (cancelled) return;
        setAllowed(self !== null);
        if (self === null) navigate("/me", { replace: true });
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false);
          navigate("/me", { replace: true });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return { allowed };
}

function Shell({
  title,
  backTo = "/admin",
  children,
}: {
  readonly title: string;
  readonly backTo?: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { allowed } = useAdminGate();

  return (
    <InnerPage title={title} backTo={backTo}>
      {allowed === true ? children : <SkeletonRows rows={4} />}
    </InnerPage>
  );
}

/** A read-only label/value row, the same shape the settings screen uses. */
function InfoRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}): React.JSX.Element {
  /**
   * S16：英文标签更长。标签 `min-w-0` 可换行；值仍然 `shrink-0` 不折断数字，较长的值
   * （如“3（另有 1 个只满足一半）”）允许换行并右对齐。
   */
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
      <span className="min-w-0 text-sm text-ink">{label}</span>
      <span className="max-w-[60%] shrink-0 text-right text-helper text-muted [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

/**
 * `2026/10/17 10:32` — the console is a desktop screen, so a compact timestamp is fine.
 *
 * S16：按当前界面语言格式化（中文输出与原来的 `toLocaleString("zh-CN", …)` 相同）。
 */
function stamp(value: string | null): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";

  return formatInstant(parsed, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function count(value: number): string {
  return String(value);
}

// ---------------------------------------------------------------------------
// /admin — overview
// ---------------------------------------------------------------------------
export function AdminOverviewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { state, reload } = useLoad(fetchAdminOverview);
  const { t } = useI18n();

  return (
    /**
     * ⚠️ **The overview's fallback parent is 设置, not `/admin`.** Its only entry is
     * 设置 → 系统管理 (`SettingsPage`), and a deep link or a reload has no history to go
     * back through — so the fallback has to be the screen the reader actually came from.
     * The sub-pages keep `/admin` as their fallback, which is correct for them.
     */
    <Shell title={t("admin.overview.title")} backTo="/settings">
      {state.kind === "loading" ? <SkeletonRows rows={5} /> : null}
      {state.kind === "error" ? <ErrorState message={state.message} onRetry={reload} /> : null}
      {state.kind === "ready" ? <OverviewBody data={state.data} onNavigate={navigate} /> : null}
    </Shell>
  );
}

function OverviewBody({
  data,
  onNavigate,
}: {
  readonly data: AdminOverviewResponse;
  readonly onNavigate: (to: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      <SectionFrame title={t("admin.overview.summary")}>
        <InfoRow label={t("admin.overview.totalAccounts")} value={count(data.users.total)} />
        <InfoRow label={t("admin.overview.suspendedAccounts")} value={count(data.users.suspended)} />
        <InfoRow label={t("admin.overview.totalLedgers")} value={count(data.books.total)} />
        <InfoRow
          label={t("admin.overview.admins")}
          value={
            data.admins.halfConfigured > 0
              ? t("admin.overview.adminsHalf", {
                  active: count(data.admins.active),
                  half: count(data.admins.halfConfigured),
                })
              : count(data.admins.active)
          }
        />
      </SectionFrame>

      <SectionFrame title={t("admin.overview.invites")}>
        <InfoRow label={t("admin.inviteStatus.available")} value={count(data.invites.available)} />
        <InfoRow label={t("admin.inviteStatus.used")} value={count(data.invites.used)} />
        <InfoRow label={t("admin.inviteStatus.revoked")} value={count(data.invites.revoked)} />
        <InfoRow label={t("admin.inviteStatus.expired")} value={count(data.invites.expired)} />
      </SectionFrame>

      <SectionFrame title={t("admin.overview.backup")}>
        {data.lastBackup === null ? (
          /**
           * ⚠️ **"还没有记录" is the honest answer.** The writer is connected now, but a fresh
           * deployment (or a failed write) still has no row; "normal" would be invented.
           */
          <p className="px-5 py-4 text-body-relaxed text-muted">
            {t("admin.overview.noBackup")}
          </p>
        ) : (
          <>
            <InfoRow label={t("admin.overview.lastBackup")} value={stamp(data.lastBackup.at)} />
            <InfoRow
              label={t("admin.overview.result")}
              value={
                data.lastBackup.stale
                  ? t("admin.overview.resultUnknown")
                  : data.lastBackup.ok
                    ? t("admin.overview.resultOk")
                    : t("admin.overview.resultFailed")
              }
            />
            {data.lastBackup.stale ? (
              <InfoRow
                label={t("admin.overview.lastRecordedResult")}
                value={data.lastBackup.ok ? t("admin.overview.resultOk") : t("admin.overview.resultFailed")}
              />
            ) : null}
            {data.lastBackup.stale ? (
              <p className="px-5 pb-4 text-helper-relaxed text-muted">
                {t("admin.overview.staleNote")}
              </p>
            ) : null}
            {data.lastBackup.note === null ? null : (
              <InfoRow label={t("admin.overview.note")} value={data.lastBackup.note} />
            )}
          </>
        )}
      </SectionFrame>

      <SectionFrame
        title={t("admin.overview.recent")}
        action={
          <button
            type="button"
            className="text-brand transition hover:text-brand-dark"
            onClick={() => { onNavigate("/admin/audit"); }}
          >
            {t("admin.overview.all")}
          </button>
        }
      >
        {data.recentActions.length === 0 ? (
          <p className="px-5 py-4 text-body-relaxed text-muted">{t("admin.overview.noRecent")}</p>
        ) : (
          data.recentActions.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 last:border-b-0"
            >
              <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
                <span className="text-sm text-ink">{entry.action}</span>
                <span className="text-helper text-muted">
                  {entry.adminUsername}
                  {entry.target === null ? "" : ` · ${entry.target}`}
                </span>
              </span>
              <span className="shrink-0 text-helper text-muted">{stamp(entry.at)}</span>
            </div>
          ))
        )}
      </SectionFrame>

      <div className="flex flex-col gap-3 px-6 py-7">
        <Button variant="secondary" onClick={() => { onNavigate("/admin/invites"); }}>
          {t("admin.overview.goInvites")}
        </Button>
        <Button variant="secondary" onClick={() => { onNavigate("/admin/admins"); }}>
          {t("admin.overview.goAdmins")}
        </Button>
        <Button variant="secondary" onClick={() => { onNavigate("/admin/users"); }}>
          {t("admin.overview.goUsers")}
        </Button>
        <Button variant="secondary" onClick={() => { onNavigate("/admin/lifecycle"); }}>
          {t("admin.overview.goLifecycle")}
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// /admin/invites
// ---------------------------------------------------------------------------
/** S16：邀请码状态的文字按状态 ID 在渲染时取（`admin.inviteStatus.<status>`），不再放模块顶层常量。 */
export function AdminInvitesPage(): React.JSX.Element {
  const { state, reload } = useLoad(fetchAdminInvites);
  const { t } = useI18n();
  const [created, setCreated] = useState<{ code: string; note: string | null } | null>(null);
  const [shape, setShape] = useState<"ordinary" | "reserved">("ordinary");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AdminInvite | null>(null);

  const submit = useCallback(() => {
    setBusy(true);
    setMessage(null);

    void createAdminInvite({ shape, ...(note.trim() === "" ? {} : { note: note.trim() }) })
      .then((response) => {
        setCreated({ code: response.code, note: response.invite.note });
        setNote("");
        reload();
      })
      .catch((error: unknown) => { setMessage(errorMessage(error)); })
      .finally(() => { setBusy(false); });
  }, [shape, note, reload]);

  return (
    <Shell title={t("admin.invites.title")}>
      <SectionFrame title={t("admin.invites.create")}>
        <div className="flex flex-col gap-4 px-5 py-4">
          {/* S16：两个形状按钮在英文下更长，窄屏允许换行 */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={shape === "ordinary" ? "primary" : "secondary"}
              fullWidth={false}
              onClick={() => { setShape("ordinary"); }}
            >
              {t("admin.invites.ordinary")}
            </Button>
            <Button
              variant={shape === "reserved" ? "primary" : "secondary"}
              fullWidth={false}
              onClick={() => { setShape("reserved"); }}
            >
              {t("admin.invites.reserved")}
            </Button>
          </div>

          <p className="text-helper-relaxed text-muted">
            {shape === "ordinary"
              ? t("admin.invites.ordinaryHint")
              : t("admin.invites.reservedHint")}
          </p>

          <TextField
            label={t("admin.invites.noteLabel")}
            value={note}
            maxLength={200}
            onChange={(event) => { setNote(event.target.value); }}
            placeholder={t("admin.invites.notePlaceholder")}
          />

          {message === null ? null : <Alert tone="error">{message}</Alert>}

          <Button disabled={busy} onClick={submit}>
            {busy ? t("admin.invites.creating") : t("admin.invites.submit")}
          </Button>
        </div>
      </SectionFrame>

      {created === null ? null : (
        <SectionFrame title={t("admin.invites.newCode")}>
          <div className="flex flex-col gap-3 px-5 py-4">
            <Alert tone="info">
              {t("admin.invites.newCodeWarning")}
            </Alert>
            <CopyButton text={created.code} label={t("admin.invites.copy")} hint={t("admin.invites.copyHint")} />
            <Button variant="ghost" onClick={() => { setCreated(null); }}>
              {t("admin.invites.saved")}
            </Button>
          </div>
        </SectionFrame>
      )}

      <SectionFrame title={t("admin.invites.all")}>
        {state.kind === "loading" ? <SkeletonRows rows={4} /> : null}
        {state.kind === "error" ? <ErrorState message={state.message} onRetry={reload} /> : null}
        {state.kind === "ready" ? (
          state.data.invites.length === 0 ? (
            <EmptyState title={t("admin.invites.emptyTitle")} description={t("admin.invites.emptyDescription")} />
          ) : (
            <InviteList invites={state.data.invites} onRevoke={setRevoking} />
          )
        ) : null}
      </SectionFrame>

      {revoking === null ? null : (
        <RevokeInviteDialog
          invite={revoking}
          onCancel={() => { setRevoking(null); }}
          onDone={() => { setRevoking(null); reload(); }}
        />
      )}
    </Shell>
  );
}

function InviteList({
  invites,
  onRevoke,
}: {
  readonly invites: readonly AdminInvite[];
  readonly onRevoke: (invite: AdminInvite) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 last:border-b-0"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-mono text-sm text-ink">{invite.maskedCode}</span>
            <span className="truncate text-helper text-muted">
              {invite.note ?? t("admin.invites.noNote")}
              {invite.accountNumber === null ? "" : ` · ${t("admin.invites.reservedNumber", { number: invite.accountNumber })}`}
            </span>
            <span className="text-helper text-muted">
              {t(`admin.inviteStatus.${invite.status}`)}
              {invite.usedByUsername === null ? "" : ` · ${invite.usedByUsername}`}
              {` · ${stamp(invite.createdAt)}`}
            </span>
          </span>
          {invite.status === "revoked" ? null : (
            <button
              type="button"
              className="shrink-0 text-xs text-danger transition hover:text-danger-dark"
              onClick={() => { onRevoke(invite); }}
            >
              {t("admin.invites.revoke")}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * Revoking asks for a reason **and the administrator's password**.
 *
 * ⚠️ **The password is the second factor, and it is checked by the server** — the dialog only
 * collects it. A confirmation dialog alone protects nobody: the rule has to hold for a request
 * that never rendered the dialog.
 */
function RevokeInviteDialog({
  invite,
  onCancel,
  onDone,
}: {
  readonly invite: AdminInvite;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const needsAcknowledgement = invite.status === "used";
  const { t } = useI18n();

  return (
    <ConfirmDialog
      open
      tone="danger"
      title={t("admin.revoke.title")}
      description={
        invite.note === null
          ? invite.maskedCode
          : t("admin.revoke.withNote", { code: invite.maskedCode, note: invite.note })
      }
      consequences={[
        t("admin.revoke.consequence"),
        ...(needsAcknowledgement
          ? [
              t("admin.revoke.usedWarning"),
              t("admin.revoke.usedFollowUp"),
            ]
          : [t("admin.revoke.reservedKept")]),
      ]}
      confirmLabel={t("admin.revoke.confirm")}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (reason.trim() === "" || password === "") {
          setMessage(t("admin.form.reasonAndPasswordRequired"));
          return;
        }
        if (needsAcknowledgement && !acknowledge) {
          setMessage(t("admin.revoke.acknowledgeRequired"));
          return;
        }

        setBusy(true);
        setMessage(null);

        void revokeAdminInvite(invite.id, {
          reason: reason.trim(),
          password,
          ...(needsAcknowledgement ? { acknowledgeUsed: true } : {}),
        })
          .then(onDone)
          .catch((error: unknown) => { setMessage(errorMessage(error)); })
          .finally(() => { setBusy(false); });
      }}
    >
      <div className="mt-4 flex flex-col gap-3">
        <TextField
          label={t("admin.form.reason")}
          value={reason}
          maxLength={200}
          onChange={(event) => { setReason(event.target.value); }}
        />
        <TextField
          label={t("admin.form.password")}
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => { setPassword(event.target.value); }}
        />
        {needsAcknowledgement ? (
          <label className="flex items-start gap-2 text-helper-relaxed text-muted">
            <input
              type="checkbox"
              checked={acknowledge}
              onChange={(event) => { setAcknowledge(event.target.checked); }}
              className="mt-0.5"
            />
            <span>{t("admin.revoke.acknowledge")}</span>
          </label>
        ) : null}
        {message === null ? null : <Alert tone="error">{message}</Alert>}
      </div>
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------------------
// /admin/admins — read-only on purpose
// ---------------------------------------------------------------------------
/**
 * 名单状态的稳定 ID（服务器原样返回）。文字在渲染时按 `admin.roster.status.<id>` 取；
 * 不认识的状态原样显示——和原来 `ROSTER_LABEL[status] ?? status` 的回退一致。
 */
const ROSTER_STATUSES = ["active", "grant_only", "allowlist_only", "eligible"] as const;
type RosterStatus = (typeof ROSTER_STATUSES)[number];

function rosterLabel(status: string): string {
  return (ROSTER_STATUSES as readonly string[]).includes(status)
    ? translate(`admin.roster.status.${status as RosterStatus}`)
    : status;
}

export function AdminAdminsPage(): React.JSX.Element {
  const { state, reload } = useLoad(fetchAdminRoster);
  const { t } = useI18n();

  return (
    <Shell title={t("admin.roster.title")}>
      <SectionFrame title={t("admin.roster.current")}>
        {state.kind === "loading" ? <SkeletonRows rows={3} /> : null}
        {state.kind === "error" ? <ErrorState message={state.message} onRetry={reload} /> : null}
        {state.kind === "ready" ? <RosterList data={state.data} /> : null}
      </SectionFrame>

      <SectionFrame title={t("admin.roster.whyTitle")}>
        <p className="px-5 py-4 text-body-relaxed text-muted">
          <Trans
            i18nKey="admin.roster.whyCommands"
            components={{ code: <code className="mx-1 font-mono text-xs" /> }}
          />
        </p>
        <p className="px-5 pb-4 text-body-relaxed text-muted">
          {t("admin.roster.whyRisk")}
        </p>
      </SectionFrame>
    </Shell>
  );
}

function RosterList({ data }: { readonly data: AdminRosterResponse }): React.JSX.Element {
  const { t } = useI18n();

  if (data.entries.length === 0) {
    return <EmptyState title={t("admin.roster.emptyTitle")} description={t("admin.roster.emptyDescription")} />;
  }

  return (
    <>
      <p className="px-5 py-3 text-helper text-muted">
        {t("admin.roster.eligibleTotal", { count: data.eligibleTotal })}
      </p>
      {data.entries.map((entry) => (
        <div key={entry.userId} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3.5">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-ink [overflow-wrap:anywhere]">
              {entry.username} · {entry.accountNumber}
            </span>
            <span
              className={`text-helper ${entry.status === "active" ? "text-brand-dark" : "text-muted"}`}
            >
              {rosterLabel(entry.status)}
            </span>
          </span>
          <span className="shrink-0 text-helper text-muted">
            {entry.status === "active" ? stamp(entry.grantedAt) : ""}
          </span>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// /admin/users
// ---------------------------------------------------------------------------
export function AdminUsersPage(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<AdminUserSearchResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{
    user: AdminUserSearchResponse["users"][number];
    kind: "suspend" | "restore";
  } | null>(null);

  const search = useCallback(() => {
    const trimmed = query.trim();
    if (trimmed === "") {
      setResult(null);
      setMessage(null);
      return;
    }

    setBusy(true);
    setMessage(null);

    void searchAdminUsers(trimmed)
      .then(setResult)
      .catch((error: unknown) => { setMessage(errorMessage(error)); })
      .finally(() => { setBusy(false); });
  }, [query]);

  const { t } = useI18n();

  return (
    <Shell title={t("admin.users.title")}>
      <SectionFrame title={t("admin.users.exact")} bare>
        <div className="flex flex-col gap-3 px-6">
          <TextField
            label={t("admin.users.queryLabel")}
            value={query}
            onChange={(event) => { setQuery(event.target.value); }}
            placeholder={t("admin.users.queryPlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter") search();
            }}
          />
          <Button disabled={busy} onClick={search}>
            {busy ? t("admin.users.searching") : t("admin.users.search")}
          </Button>
          <p className="text-helper text-muted">
            {t("admin.users.exactNote")}
          </p>
          {message === null ? null : <Alert tone="error">{message}</Alert>}
        </div>
      </SectionFrame>

      {result === null ? null : (
        <SectionFrame title={t("admin.users.results")}>
          {result.users.length === 0 ? (
            <EmptyState title={t("admin.users.emptyTitle")} description={t("admin.users.emptyDescription")} />
          ) : (
            result.users.map((user) => (
              <div key={user.userId} className="flex flex-col gap-2 border-b border-line px-5 py-4 last:border-b-0">
                <span className="text-sm text-ink [overflow-wrap:anywhere]">
                  {user.username} · {user.accountNumber}
                </span>
                <span className="text-helper text-muted [overflow-wrap:anywhere]">
                  {user.displayName} · {t("admin.users.registeredAt", { date: stamp(user.createdAt) })}
                  {user.isDemo ? ` · ${t("admin.users.demo")}` : ""}
                  {user.isActiveAdmin ? ` · ${t("admin.users.admin")}` : ""}
                  {user.suspendedAt === null ? "" : ` · ${t("admin.users.suspendedAt", { date: stamp(user.suspendedAt) })}`}
                  {` · ${t("admin.users.sessions", { count: user.activeSessions })}`}
                </span>
                <Button
                  variant={user.suspendedAt === null ? "danger" : "secondary"}
                  fullWidth={false}
                  onClick={() => {
                    setAction({ user, kind: user.suspendedAt === null ? "suspend" : "restore" });
                  }}
                >
                  {user.suspendedAt === null ? t("admin.users.suspend") : t("admin.users.restore")}
                </Button>
              </div>
            ))
          )}
        </SectionFrame>
      )}

      {action === null ? null : (
        <AccountActionDialog
          user={action.user}
          kind={action.kind}
          onCancel={() => { setAction(null); }}
          onDone={() => {
            setAction(null);
            search();
          }}
        />
      )}
    </Shell>
  );
}

function AccountActionDialog({
  user,
  kind,
  onCancel,
  onDone,
}: {
  readonly user: AdminUserSearchResponse["users"][number];
  readonly kind: "suspend" | "restore";
  readonly onCancel: () => void;
  readonly onDone: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const suspending = kind === "suspend";
  const { t } = useI18n();

  return (
    <ConfirmDialog
      open
      tone={suspending ? "danger" : "default"}
      title={suspending ? t("admin.accountAction.suspendTitle") : t("admin.accountAction.restoreTitle")}
      description={t("admin.accountAction.target", { username: user.username, accountNumber: user.accountNumber })}
      consequences={
        suspending
          ? [
              t("admin.accountAction.suspendSessions", { count: user.activeSessions }),
              t("admin.accountAction.suspendLogin"),
              t("admin.accountAction.suspendData"),
            ]
          : [t("admin.accountAction.restoreLogin"), t("admin.accountAction.restoreSessions")]
      }
      confirmLabel={suspending ? t("admin.accountAction.suspend") : t("admin.accountAction.restore")}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (reason.trim() === "" || password === "") {
          setMessage(t("admin.form.reasonAndPasswordRequired"));
          return;
        }

        setBusy(true);
        setMessage(null);

        const body = { reason: reason.trim(), password };
        const call = suspending
          ? suspendAdminUser(user.userId, body)
          : restoreAdminUser(user.userId, body);

        void call
          .then(onDone)
          .catch((error: unknown) => { setMessage(errorMessage(error)); })
          .finally(() => { setBusy(false); });
      }}
    >
      <div className="mt-4 flex flex-col gap-3">
        <TextField
          label={t("admin.form.reason")}
          value={reason}
          maxLength={200}
          onChange={(event) => { setReason(event.target.value); }}
        />
        <TextField
          label={t("admin.form.password")}
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => { setPassword(event.target.value); }}
        />
        {message === null ? null : <Alert tone="error">{message}</Alert>}
      </div>
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------------------
// /admin/audit
// ---------------------------------------------------------------------------
export function AdminAuditPage(): React.JSX.Element {
  const { state, reload } = useLoad(fetchAdminAudit);
  const { t } = useI18n();

  return (
    <Shell title={t("admin.audit.title")}>
      <SectionFrame title={t("admin.audit.latest")}>
        {state.kind === "loading" ? <SkeletonRows rows={5} /> : null}
        {state.kind === "error" ? <ErrorState message={state.message} onRetry={reload} /> : null}
        {state.kind === "ready" ? <AuditList data={state.data} /> : null}
      </SectionFrame>
      <SectionFrame title={t("admin.audit.about")}>
        <p className="px-5 py-4 text-body-relaxed text-muted">
          {t("admin.audit.retention")}
        </p>
      </SectionFrame>
    </Shell>
  );
}

/**
 * ⚠️ `entry.action` 是稳定标识（`invite.create` 等，见 `@libellum/shared` 的 `AUDIT_ACTIONS`），
 * 改动前后都原样显示，S16 不给它加译名——中文界面也一直显示标识本身。
 */
function AuditList({ data }: { readonly data: AdminAuditListResponse }): React.JSX.Element {
  const { t } = useI18n();

  if (data.entries.length === 0) {
    return <EmptyState title={t("admin.audit.emptyTitle")} description={t("admin.audit.emptyDescription")} />;
  }

  return (
    <>
      {data.entries.map((entry) => (
        <div key={entry.id} className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm text-ink">{entry.action}</span>
            <span className="truncate text-helper text-muted">
              {entry.adminUsername}
              {entry.target === null ? "" : ` · ${entry.target}`}
              {entry.outcome === "failed" ? ` · ${t("admin.audit.refused")}` : ""}
            </span>
          </span>
          <span className="shrink-0 text-helper text-muted">{stamp(entry.at)}</span>
        </div>
      ))}
    </>
  );
}
