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
import { BottomSheet } from "./BottomSheet.js";
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

  const note =
    avatarId === "daoxuan-special"
      ? t("account.avatars.notes.daoxuan-special")
      : t("account.avatars.notes.descent-special");

  return (
    /**
     * 弹出面板模板 T4 信息说明（1.19.59）：按内容高度，模板标题行与右上角 ×；遮罩改为模板的变暗遮罩
     * （原来 45% 墨色在深色下发白），Esc、焦点、下拉关闭由外壳负责。宽屏仍居中成小对话框（与原来相同）。
     * 「知道了」是这类说明唯一的动作，放在固定底部操作区，走外壳的关闭（播放退场）。
     */
    <BottomSheet
      label={t("account.avatars.creationNoteTitle")}
      title={t("account.avatars.creationNoteTitle")}
      detent="content"
      bodyClassName="px-5 pt-1 pb-2"
      footer={({ close }) => (
        <div className="flex justify-end">
          <Button onClick={close}>{t("account.avatars.creationNoteClose")}</Button>
        </div>
      )}
      onClose={onClose}
    >
      <p className="text-helper-relaxed text-ink">{note}</p>
    </BottomSheet>
  );
}

export default AvatarCreationNoteSheet;
