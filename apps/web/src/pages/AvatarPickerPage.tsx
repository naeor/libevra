import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  AVATAR_REWARD_ACTIVITIES,
  SELECTABLE_AVATAR_IDS,
  avatarIdSchema,
  isSpecialAvatarId,
  type AvatarId,
  type SpecialAvatarId,
} from "@libellum/shared";
import { useAuth } from "../auth/AuthProvider.js";
import { AvatarCreationNoteSheet, hasCreationNote } from "../components/AvatarCreationNoteSheet.js";
import { UserAvatar, avatarDescription, avatarLabel } from "../components/UserAvatar.js";
import { useI18n } from "../i18n/index.js";
import { InnerPage } from "../components/Layouts.js";
import { Button } from "../components/Button.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { errorMessage } from "../lib/api.js";
import { useAvatarRewards } from "../lib/avatarRewards.js";
import { useSaveProfile } from "../lib/profile.js";
import { useDraftExit } from "../lib/profileDraft.js";

/** 小锁图标：只在网格里标记“还没解锁”，不抢头像的视觉。 */
function LockGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

export function AvatarPickerPage(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const saveProfile = useSaveProfile();
  const rewards = useAvatarRewards();
  const [original] = useState(() => avatarIdSchema.catch("flower").parse(user?.avatarId));
  const [selected, setSelected] = useState<AvatarId>(original);
  const [busy, setBusy] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = selected !== original;
  const legacy = !(SELECTABLE_AVATAR_IDS as readonly string[]).includes(original);
  const unlocked = rewards.data?.unlocked ?? [];
  const unlockedIds = unlocked.map(entry => entry.avatarId);
  /**
   * 特典系列内部按真实解锁状态排序：已解锁在前，未解锁在后（S16 头像页 UI 优化）。
   * 顺序每次渲染都从服务端状态算，不写死「某款永远在最后」。
   */
  const orderedSpecialIds = (["daoxuan-special", "descent-special"] as const)
    .map(id => id as SpecialAvatarId)
    .sort((first, second) => Number(unlockedIds.includes(second)) - Number(unlockedIds.includes(first)));
  const selectedUnlock = unlocked.find(entry => entry.avatarId === selected);
  const locked = isSpecialAvatarId(selected) && !unlockedIds.includes(selected);
  const selectedActivity = AVATAR_REWARD_ACTIVITIES.find(activity => activity.avatarId === selected);
  const groups: readonly { key: string; label: string; ids: readonly AvatarId[] }[] = [
    ...(legacy ? [{ key: "current", label: t("account.avatars.current"), ids: [original] }] : []),
    { key: "basic", label: t("account.avatars.basic"), ids: SELECTABLE_AVATAR_IDS.filter(id => !isSpecialAvatarId(id)) },
    { key: "special", label: t("account.avatars.special"), ids: orderedSpecialIds },
  ];
  const selectedGroup = groups.find(group => group.ids.includes(selected))!;
  const description = avatarDescription(selected);
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  useDraftExit(dirty || busy);

  useEffect(() => {
    if (!noteOpen) return;

    const close = (): void => {
      setNoteOpen(false);
    };
    // 备注面板打开时按 Esc 关闭由面板自己处理；这里只负责在头像切换时收起。
    return close;
  }, [noteOpen, selected]);

  if (!user) return <></>;

  const leave = (): void => {
    void navigate("/profile?edit=1", { replace: true });
  };
  const back = (): void => {
    if (!busy) {
      if (dirty) setDiscard(true);
      else leave();
    }
  };

  async function save(): Promise<void> {
    if (inFlight || !dirty || locked) return;

    setInFlight(true);
    setBusy(true);
    setError(null);
    try {
      await saveProfile({ field: "avatarId", value: selected, previousValue: original as AvatarId });
      leave();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setInFlight(false);
      setBusy(false);
    }
  }

  const unlockHint = ((): string | null => {
    if (!locked) return null;

    return selectedActivity?.rule.kind === "first_login"
      ? t("account.avatars.unlockFirstLogin")
      : t("account.avatars.unlockPhilosophyDay");
  })();

  return (
    <InnerPage title={t("account.avatars.title")} backTo="/profile?edit=1" onBack={back}>
      <section
        aria-label={t("account.avatars.preview")}
        className="flex w-full flex-col items-center gap-4 py-4 text-center"
      >
        <UserAvatar avatarId={selected} className="size-28" />
        {/*
          名称 / 系列 / 题注 / 解锁状态 / 创作注记共用同一条水平中轴（S16 头像页 UI 优化）：
          外层用 flex-col + items-center 居中，文字容器限宽并居中；题注与状态各留固定最小高度，
          切换头像时不会因一两行文字的长短把下方网格顶得上下跳。
        */}
        <div aria-live="polite" aria-atomic="true" className="mx-auto flex w-full max-w-[22rem] flex-col items-center text-center">
          <h2 className="text-page-title text-ink">{avatarLabel(selected)}</h2>
          <p className="mt-1 text-helper text-muted">
            {selectedGroup.label}
            {selected === "flower" ? ` · ${t("account.avatars.default")}` : ""}
            {locked ? ` · ${t("account.avatars.locked")}` : ""}
          </p>
          {description ? (
            <p className="mt-2 min-h-10 max-w-[21rem] text-helper-relaxed text-muted">{description}</p>
          ) : (
            <span aria-hidden="true" className="mt-2 min-h-10" />
          )}
          {locked && unlockHint !== null ? (
            <p className="min-h-5 max-w-[21rem] text-helper-relaxed text-muted">{unlockHint}</p>
          ) : !locked && selectedUnlock !== undefined ? (
            <p className="min-h-5 text-helper text-muted">
              {t("account.avatars.unlockedAt", { date: dateFormatter.format(new Date(selectedUnlock.unlockedAt)) })}
            </p>
          ) : (
            <span aria-hidden="true" className="min-h-5" />
          )}
          {hasCreationNote(selected) ? (
            <button
              type="button"
              onClick={() => {
                setNoteOpen(true);
              }}
              className="mt-2 text-helper text-brand-dark underline-offset-2 hover:underline"
            >
              {t("account.avatars.creationNote")}
            </button>
          ) : null}
        </div>
      </section>
      {groups.map(group => (
        <section key={group.key} aria-labelledby={`avatars-${group.key}`} className="flex flex-col gap-4">
          <h2 id={`avatars-${group.key}`} className="text-section-title text-ink">
            {group.label}
          </h2>
          <div className="grid grid-cols-4 gap-x-3 gap-y-4 min-[400px]:grid-cols-5 md:grid-cols-6" role="group" aria-label={group.label}>
            {group.ids.map(id => {
              const buttonLocked = isSpecialAvatarId(id) && !unlockedIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-label={avatarLabel(id)}
                  title={avatarLabel(id)}
                  aria-pressed={selected === id}
                  data-locked={buttonLocked ? "true" : undefined}
                  disabled={busy}
                  onClick={() => {
                    setSelected(id);
                    setError(null);
                  }}
                  className="group relative flex min-h-11 min-w-0 items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-focus-ring disabled:opacity-45"
                >
                  <span
                    className={`w-full rounded-full p-1 ring-2 ring-offset-2 ring-offset-canvas transition motion-reduce:transition-none ${
                      selected === id ? "ring-brand" : "ring-transparent group-hover:ring-line"
                    }`}
                  >
                    {/*
                      未解锁 ≠ 不可见：保留完整图案与轮廓，只做柔和降饱和（灰绿色），
                      不套黑白滤镜、不改变已解锁头像的配色（S16 头像页 UI 优化）。
                    */}
                    <span className={`block rounded-full ${buttonLocked ? "opacity-90 saturate-[.4] contrast-[.95]" : ""}`}>
                      <UserAvatar avatarId={id} className="aspect-square w-full" />
                    </span>
                  </span>
                  {buttonLocked ? (
                    <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-surface/95 text-muted ring-1 ring-line">
                      <LockGlyph />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <div className="sticky bottom-0 z-10 -mx-2 mt-auto border-t border-line bg-canvas px-2 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        {error ? (
          <p role="alert" className="mb-3 text-helper text-danger">
            {error}
          </p>
        ) : null}
        {locked ? <p className="mb-3 text-helper text-muted">{t("account.avatars.lockedSaveHint")}</p> : null}
        {/*
          深色主按钮禁用后整块 45% 透明，文字对比度会掉到 AA 以下；禁用态改用浅底深字
          的独立外观（S16 头像页 UI 优化），不靠工具类顺序去覆盖变体样式。
        */}
        <Button
          disabled={!dirty || busy || locked}
          disabledClassName="bg-surface text-muted shadow-none ring-1 ring-line"
          onClick={() => void save()}
        >
          {busy ? t("account.profile.saving") : t("account.profile.save")}
        </Button>
      </div>
      <ConfirmDialog
        open={discard}
        title={t("account.avatars.discardTitle")}
        description={t("account.avatars.discardDescription")}
        confirmLabel={t("account.avatars.discard")}
        cancelLabel={t("account.avatars.continue")}
        onCancel={() => setDiscard(false)}
        onConfirm={leave}
      />
      {noteOpen && hasCreationNote(selected) ? (
        <AvatarCreationNoteSheet
          avatarId={selected}
          onClose={() => {
            setNoteOpen(false);
          }}
        />
      ) : null}
    </InnerPage>
  );
}
