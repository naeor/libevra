import { useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n/index.js";
import { copyText } from "../lib/clipboard.js";
import { BottomSheet } from "./BottomSheet.js";
import { Button } from "./Button.js";

/**
 * 账号编号的局部操作面板。
 *
 * 弹出面板模板 T4 信息说明（1.19.59）：原来是原生 `<dialog>` + 私有的 WAAPI 进出动画；现在与其他底部面板
 * 同一个 `BottomSheet` 外壳——同一套遮罩、进出动画、下拉关闭、模板标题行与右上角 ×、焦点与 Esc、滚动锁，
 * 不再进浏览器的顶层（top layer），Pad 分屏时只盖住所在工作区。
 *
 * ⚠️ **复制不再传容器。** 原生模态 dialog 会让外部元素不可聚焦，所以原来把 dialog 传给 `copyText` 当复制
 * 用的临时输入框的容器；现在面板不是原生 dialog，外部元素照常可聚焦，走与软件更新「更多」菜单相同的默认
 * 路径（临时输入框挂在 body 上）。
 */
export function ProfileAccountNumberSheet({
  open,
  number,
  onClose,
}: {
  readonly open: boolean;
  readonly number: string;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <BottomSheet
      label={t("account.accountNumberSheet.title")}
      title={t("account.accountNumberSheet.title")}
      detent="content"
      wide="bottom"
      bodyClassName="px-5 pt-1 pb-4"
      initialFocus={(panel) => panel.querySelector<HTMLButtonElement>("[data-sheet-close]")}
      onClose={onClose}
    >
      <AccountNumberBody number={number} />
    </BottomSheet>
  );
}

function AccountNumberBody({ number }: { readonly number: string }): React.JSX.Element {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"idle" | "copying" | "copied" | "manual">("idle");
  /** 面板关闭（卸载）后不再回写复制结果。 */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function copy(): Promise<void> {
    setPhase("copying");
    const outcome = await copyText(number);
    if (mounted.current) setPhase(outcome === "copied" ? "copied" : "manual");
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="select-all py-2 text-center font-mono text-page-title text-ink tabular-nums">{number}</p>
      <Button onClick={() => void copy()} disabled={phase === "copying"}>
        {phase === "copied"
          ? t("account.accountNumberSheet.copied")
          : phase === "copying"
            ? t("account.accountNumberSheet.copying")
            : t("account.accountNumberSheet.copy")}
      </Button>
      <p role="status" aria-live="polite" className="min-h-5 text-center text-helper-relaxed text-muted">
        {phase === "manual"
          ? t("account.accountNumberSheet.manual")
          : phase === "copied"
            ? t("account.accountNumberSheet.copiedStatus")
            : ""}
      </p>
    </div>
  );
}
