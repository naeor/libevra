import { InnerPage } from "../components/Layouts.js";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, useI18n, type Locale } from "../i18n/index.js";
import { browserLanguages, detectLocale } from "../i18n/locales.js";
import type { LanguagePreference } from "../lib/language.js";
import { useLanguagePreference } from "../lib/languageRuntime.js";

/**
 * `/settings/appearance/language` — 界面语言（S16 国际化）。
 *
 * ⚠️ **三项：跟随系统 / 简体中文 / English。** 语言名称用各自的语言书写（不翻译），
 * 切到看不懂的语言也能认出自己的那一项。选择立即生效、不刷新页面，并保存在本机。
 *
 * ⚠️ **游客也能用**：路由用 `RequireSession`（正式账号与游客都可进入）；登录前的登录 / 注册 /
 * 找回页另有一个直接切换的按钮（`LanguageSwitch`），不必先进设置。
 */
export function LanguageChoiceList({
  preference,
  locale,
  onChoose,
}: {
  readonly preference: LanguagePreference;
  readonly locale: Locale;
  readonly onChoose: (next: LanguagePreference) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const options: readonly { value: LanguagePreference; label: string; hint?: string; lang?: string }[] = [
    {
      value: "system",
      label: t("language.system"),
      // 「跟随系统」那一行说的是系统语言会解析成什么，与当前是否选中它无关。
      hint: t("language.systemHint", {
        language: LOCALE_NATIVE_NAMES[preference === "system" ? locale : detectLocale(browserLanguages())],
      }),
    },
    ...SUPPORTED_LOCALES.map((value) => ({ value, label: LOCALE_NATIVE_NAMES[value], lang: value })),
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("language.switchLabel")}
      className="overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line"
    >
      {options.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-language-option={option.value}
            onClick={() => {
              onChoose(option.value);
            }}
            className="flex min-h-13 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-canvas focus-visible:bg-brand-soft focus-visible:outline-none active:bg-brand-soft/60"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-card-title text-ink" {...(option.lang === undefined ? {} : { lang: option.lang })}>
                {option.label}
              </span>
              {option.hint === undefined ? null : (
                <span className="text-helper-relaxed text-muted">{option.hint}</span>
              )}
            </span>
            <span
              aria-hidden="true"
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                selected ? "border-brand bg-brand" : "border-line bg-surface"
              }`}
            >
              {selected ? <span className="size-2 rounded-full bg-on-brand" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function LanguagePage(): React.JSX.Element {
  const { t } = useI18n();
  const language = useLanguagePreference();

  return (
    <InnerPage title={t("language.pageTitle")} backTo="/settings/appearance">
      <div className="flex flex-col gap-3">
        <LanguageChoiceList preference={language.preference} locale={language.locale} onChoose={language.choose} />
        <p className="px-1 text-helper-relaxed text-muted">{t("language.note")}</p>
      </div>
    </InnerPage>
  );
}
