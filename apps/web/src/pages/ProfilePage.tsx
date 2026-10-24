import { displayNameSchema, usernameSchema, type SessionUser } from "@libellum/shared";
import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { InnerPage } from "../components/Layouts.js";
import { ListGroup, ListRow } from "../components/ui/List.js";
import { ProfileAccountNumberSheet } from "../components/ProfileAccountNumberSheet.js";
import { UserAvatar } from "../components/UserAvatar.js";
import { Button } from "../components/Button.js";
import { TextField } from "../components/TextField.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useAuth } from "../auth/AuthProvider.js";
import { errorMessage } from "../lib/api.js";
import { useSaveProfile } from "../lib/profile.js";
import { useDraftExit } from "../lib/profileDraft.js";

export function ProfilePreview({ user, avatarId, editable = false, onAvatar }: {
  readonly user: SessionUser;
  readonly avatarId?: string | undefined;
  readonly editable?: boolean;
  readonly onAvatar?: () => void;
}): React.JSX.Element {
  return <section className="flex flex-col items-center gap-3 py-4 text-center">
    {editable ? <button type="button" onClick={onAvatar} aria-label="选择头像" className="rounded-full outline-none transition hover:opacity-80 focus-visible:ring-4 focus-visible:ring-focus-ring"><UserAvatar avatarId={avatarId ?? user.avatarId} /></button> : <UserAvatar avatarId={avatarId ?? user.avatarId} />}
    <div className="min-w-0 max-w-full">
      <p className="break-words text-page-title text-ink">{user.displayName}</p>
      <p className="mt-1 break-all text-helper text-muted">@{user.username}</p>
    </div>
    {editable ? <button type="button" onClick={onAvatar} className="min-h-11 rounded-field px-3 text-helper text-brand-dark outline-none hover:underline focus-visible:ring-4 focus-visible:ring-focus-ring">轻点头像更换</button> : null}
  </section>;
}

function Pencil(): React.JSX.Element {
  return <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-brand-dark" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z" /></svg>;
}

export function ProfilePage(): React.JSX.Element {
  const { user } = useAuth();
  const saveProfile = useSaveProfile();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = params.get("edit") === "1";
  const [numberOpen, setNumberOpen] = useState(false);
  const [field, setField] = useState<"displayName" | "username" | null>(null);
  const [draft, setDraft] = useState("");
  const [previous, setPrevious] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const dirty = field !== null && draft !== previous;
  useDraftExit(dirty || busy);
  if (!user) return <></>;

  function askLeave(action: () => void): void {
    if (busy) return;
    if (dirty) setDiscard(() => action);
    else action();
  }
  function finish(): void {
    askLeave(() => { setField(null); setError(null); setParams({}, { replace: true }); });
  }
  function openField(next: "displayName" | "username"): void {
    askLeave(() => { setPrevious(user![next]); setDraft(user![next]); setField(next); setError(null); setNotice(null); });
  }
  async function save(): Promise<void> {
    if (field === null || inFlight.current) return;
    const parsed = (field === "displayName" ? displayNameSchema : usernameSchema).safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请检查输入"); return; }
    inFlight.current = true; setBusy(true); setError(null);
    try {
      await saveProfile({ field, value: parsed.data, previousValue: previous });
      setField(null); setNotice("资料已保存");
    } catch (caught) { setError(errorMessage(caught)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const rows = [
    { label: "昵称", value: user.displayName, field: "displayName" as const },
    { label: "用户名", value: user.username, field: "username" as const },
    { label: "账号编号", value: user.accountNumber },
    { label: "注册时间", value: new Date(user.createdAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) },
  ];
  return <InnerPage title="个人资料" backTo="/me" onBack={() => editing ? finish() : void navigate("/me")} actions={<Button variant="ghost" fullWidth={false} disabled={busy} onClick={() => editing ? finish() : setParams({ edit: "1" }, { replace: true })}>{editing ? "完成" : "编辑"}</Button>}>
    <ProfilePreview user={user} editable={editing} onAvatar={() => askLeave(() => void navigate("/profile/avatar"))} />
    <dl className={`rounded-card border border-line bg-surface px-5 ${editing ? "divide-y divide-line" : ""}`}>
      {rows.map(row => <div key={row.label} className={editing && row.field ? "py-4" : "flex min-h-8 items-center gap-4 py-4 text-body"}>
        {editing && row.field ? <><dt className="sr-only">{row.label}</dt><dd>
          <button type="button" disabled={busy} onClick={() => openField(row.field!)} className="flex min-h-11 w-full items-center gap-4 text-body outline-none focus-visible:ring-4 focus-visible:ring-focus-ring" aria-label={`编辑${row.label}`}>
            <span className="shrink-0 text-muted">{row.label}</span><span className="ml-auto min-w-0 break-all text-right text-ink">{user[row.field]}</span><Pencil />
          </button>
          {field === row.field ? <form className="mt-3 flex flex-col gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
            <TextField label={`新的${row.label}`} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} maxLength={field === "username" ? 20 : 40} autoFocus autoComplete="off" autoCapitalize={field === "username" ? "none" : "sentences"} spellCheck={field !== "username"} hint={field === "username" ? "3–20 位字母、数字或下划线。保存后请使用新用户名登录，也可通过新用户名被搜索和邀请。" : "昵称不需要唯一，其他成员会看到这个名字。"} />
            {error ? <p role="alert" className="text-helper text-danger">{error}</p> : null}
            <div className="flex gap-3"><Button type="submit" disabled={busy || !dirty}>{busy ? "正在保存…" : "保存"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => askLeave(() => { setField(null); setError(null); })}>取消</Button></div>
          </form> : null}
        </dd></> : <><dt className="shrink-0 text-muted">{row.label}</dt><dd className="ml-auto min-w-0 break-words text-right text-ink">{row.label === "账号编号" ? <button type="button" aria-label={`账号编号 ${user.accountNumber}，打开复制选项`} aria-haspopup="dialog" aria-expanded={numberOpen} onClick={() => setNumberOpen(true)} className="min-h-11 font-mono outline-none focus-visible:ring-4 focus-visible:ring-focus-ring">{row.value}</button> : row.value}</dd></>}
      </div>)}
    </dl>
    {notice ? <p role="status" className="text-helper text-brand-dark">{notice}</p> : null}
    <ListGroup title="恢复码" footer={<span className="text-warn-dark">请勿向任何人透露恢复码。恢复码应被妥善保管。</span>}><ListRow label="生成新的恢复码" to="/settings/recovery-code" /></ListGroup>
    <ProfileAccountNumberSheet open={numberOpen} number={user.accountNumber} onClose={() => setNumberOpen(false)} />
    <ConfirmDialog open={discard !== null} title="放弃未保存的修改？" description="已保存的资料不会改变。" confirmLabel="放弃修改" cancelLabel="继续编辑" onCancel={() => setDiscard(null)} onConfirm={() => { const action = discard; setDiscard(null); action?.(); }} />
  </InnerPage>;
}
