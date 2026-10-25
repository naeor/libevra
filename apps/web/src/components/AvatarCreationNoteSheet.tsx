/**
 * 特典头像的「创作注记」浮层（S16 头像奖励系统）。
 *
 * 所有者给的边界很明确：**只有存在创作背景的特典头像才有这个入口**，位置在
 * 头像名称/说明附近，但只在用户主动点击时展开；桌面端是气泡/小弹层，手机端是
 * 底部抽屉。这里用同一个面板做两种形态（`items-end` → `sm:items-center`），
 * 不引入新的依赖，也不改页面结构。
 *
 * ⚠️ 文案来自 i18n 而不是硬编码，并且只在 `notes` 里有的头像上显示入口；
 * 以后新增特典头像时，加一条 notes 词条就够，不需要动页面逻辑。
 */
import { useEffect } from "react";

import { Button } from "./Button.js";
import { useI18n } from "../i18n/index.js";
import type { SpecialAvatarId } from "@libellum/shared";

/** 只有这两款有创作注记；以后按需扩展。 */
const NOTE_AVATAR_IDS: readonly SpecialAvatarId[] = ["daoxuan-special", "descent-special"];

export function hasCreationNote(avatarId: string): avatarId is SpecialAvatarId {
  return (NOTE_AVATAR_IDS as readonly string[]).includes(avatarId);
}

export function AvatarCreationNoteSheet({
  avatarId,
  onClose,
}: {
  readonly avatarId: SpecialAvatarId;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const note =
    avatarId === "daoxuan-special"
      ? t("account.avatars.notes.daoxuan-special")
      : t("account.avatars.notes.descent-special");

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("account.avatars.creationNoteTitle")}
        onClick={event => {
          event.stopPropagation();
        }}
        className="w-full max-w-md rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-xl sm:rounded-3xl sm:pb-5"
      >
        <h2 className="text-section-title text-ink">{t("account.avatars.creationNoteTitle")}</h2>
        <p className="mt-2 text-helper-relaxed text-ink">{note}</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>{t("account.avatars.creationNoteClose")}</Button>
        </div>
      </div>
    </div>
  );
}

export default AvatarCreationNoteSheet;
