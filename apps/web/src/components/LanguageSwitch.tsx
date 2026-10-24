import { LOCALE_NATIVE_NAMES, LOCALE_SHORT_NAMES, SUPPORTED_LOCALES, useI18n } from "../i18n/index.js";
import { useLanguagePreference } from "../lib/languageRuntime.js";
import { GlobeIcon } from "./Icons.js";

/**
 * **登录前的语言切换（S16 国际化）。**
 *
 * 登录、注册、找回密码、恢复归档账本这些页面还没有“设置”可去，所以在页面右上角放一个按钮：
 * 显示**另一种语言的自称**（中文界面显示 `English`，英文界面显示 `中文`），点一下就切过去并保存在本机。
 * 只有两种语言时这是最短的路径；以后语言多了，这里改成弹出列表即可，偏好与存储不变。
 */
export function LanguageSwitch({ className = "" }: { readonly className?: string }): React.JSX.Element {
  const { t } = useI18n();
  const language = useLanguagePreference();
  const other = SUPPORTED_LOCALES.find((locale) => locale !== language.locale) ?? SUPPORTED_LOCALES[0];

  return (
    <button
      type="button"
      data-testid="language-switch"
      lang={other}
      aria-label={t("language.switchTo", { language: LOCALE_NATIVE_NAMES[other] })}
      onClick={() => {
        language.choose(other);
      }}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-helper text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring ${className}`.trim()}
    >
      <GlobeIcon className="size-4 shrink-0" />
      <span>{LOCALE_SHORT_NAMES[other]}</span>
    </button>
  );
}
