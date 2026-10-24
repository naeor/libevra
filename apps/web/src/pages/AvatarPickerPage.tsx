import { avatarIdSchema, SELECTABLE_AVATAR_IDS, type AvatarId } from "@libellum/shared";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { UserAvatar, AVATAR_LABELS } from "../components/UserAvatar.js";
import { InnerPage } from "../components/Layouts.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { errorMessage } from "../lib/api.js";
import { useSaveProfile } from "../lib/profile.js";
import { useDraftExit } from "../lib/profileDraft.js";

export function AvatarPickerPage(): React.JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const saveProfile = useSaveProfile();
  const [original] = useState(() => avatarIdSchema.catch("flower").parse(user?.avatarId));
  const [selected, setSelected] = useState<AvatarId>(original);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = selected !== original;
  const legacy = !(SELECTABLE_AVATAR_IDS as readonly string[]).includes(original);
  const groups: readonly { key: string; label: string; ids: readonly AvatarId[] }[] = [
    ...(legacy ? [{ key: "current", label: "当前头像", ids: [original] }] : []),
    { key: "basic", label: "基础系列", ids: SELECTABLE_AVATAR_IDS.filter(id => id !== "daoxuan-special") },
    { key: "special", label: "特典系列", ids: ["daoxuan-special"] },
  ];
  const selectedGroup = groups.find(group => group.ids.includes(selected))!;
  useDraftExit(dirty || busy);
  if (!user) return <></>;
  const leave = (): void => { void navigate("/profile?edit=1", { replace: true }); };
  const back = (): void => { if (!busy) { if (dirty) setDiscard(true); else leave(); } };
  async function save(): Promise<void> {
    if (inFlight.current || !dirty) return;
    inFlight.current = true; setBusy(true); setError(null);
    try { await saveProfile({ field: "avatarId", value: selected, previousValue: original as AvatarId }); leave(); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <InnerPage title="选择头像" backTo="/profile?edit=1" onBack={back}>
    <section aria-label="头像预览" className="flex flex-col items-center gap-4 py-4 text-center">
      <UserAvatar avatarId={selected} className="size-28" />
      <div aria-live="polite" aria-atomic="true">
        <h2 className="text-page-title text-ink">{AVATAR_LABELS[selected]}</h2>
        <p className="mt-1 text-helper text-muted">{selectedGroup.label}{selected === "flower" ? " · 默认" : ""}</p>
      </div>
    </section>
    <p className="text-helper text-muted">轻点预览，保存后才会更换。</p>
    {groups.map(group => <section key={group.key} aria-labelledby={`avatars-${group.key}`} className="flex flex-col gap-4">
      <h2 id={`avatars-${group.key}`} className="text-section-title text-ink">{group.label}</h2>
      <div className="grid grid-cols-4 gap-x-3 gap-y-4 min-[400px]:grid-cols-5 md:grid-cols-6" role="group" aria-label={group.label}>
        {group.ids.map(id => <button key={id} type="button" aria-label={AVATAR_LABELS[id]} title={AVATAR_LABELS[id]} aria-pressed={selected === id} disabled={busy} onClick={() => { setSelected(id); setError(null); }} className="group flex min-h-11 min-w-0 items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-focus-ring disabled:opacity-45">
          <span className={`w-full rounded-full p-1 ring-2 ring-offset-2 ring-offset-canvas transition motion-reduce:transition-none ${selected === id ? "ring-brand" : "ring-transparent group-hover:ring-line"}`}><UserAvatar avatarId={id} className="aspect-square w-full" /></span>
        </button>)}
      </div>
    </section>)}
    <div className="sticky bottom-0 z-10 -mx-2 mt-auto border-t border-line bg-canvas px-2 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      {error ? <p role="alert" className="mb-3 text-helper text-danger">{error}</p> : null}
      <Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? "正在保存…" : "保存"}</Button>
      <p role="status" className="mt-2 text-center text-helper text-muted">{dirty ? `正在预览：${AVATAR_LABELS[selected]}` : "这是你已保存的头像"}</p>
    </div>
    <ConfirmDialog open={discard} title="放弃这次头像选择？" description="你已保存的头像不会改变。" confirmLabel="放弃选择" cancelLabel="继续挑选" onCancel={() => setDiscard(false)} onConfirm={leave} />
  </InnerPage>;
}
