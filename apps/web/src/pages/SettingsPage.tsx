import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { InnerPage } from "../components/Layouts.js";
import { ListGroup } from "../components/ui/List.js";
import { SettingsCategoryCard } from "../components/SettingsCard.js";
import { useAdminEntry } from "../lib/admin.js";
import { LOCALE_NATIVE_NAMES, useI18n } from "../i18n/index.js";
import { useLanguagePreference } from "../lib/languageRuntime.js";
import { startThemeRuntime } from "../lib/theme.js";

const subscribeServer = (): (() => void) => () => undefined;
const systemMode = (): "system" => "system";

/** 设置首页只负责导航；默认币种仍由记账偏好页面的原 hook 管理。 */
export function SettingsHome({ isAdmin, onOpen }: {
  readonly isAdmin: boolean;
  readonly onOpen: (to: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const language = useLanguagePreference();
  const theme = typeof document === "undefined" ? null : startThemeRuntime();
  const mode = useSyncExternalStore(theme?.subscribe ?? subscribeServer, () => theme?.getSnapshot().mode ?? "system", systemMode);
  return (
    <div className="flex flex-col gap-5">
      <ListGroup>
        <SettingsCategoryCard title={t("settings.home.preferences.title")} description={t("settings.home.preferences.description")} to="/settings/preferences" onOpen={onOpen} />
        <SettingsCategoryCard title={t("settings.theme.title")} description={t(`settings.theme.modes.${mode}`)} to="/settings/appearance/theme" onOpen={onOpen} />
        <SettingsCategoryCard title={t("language.title")} description={language.preference === "system" ? `${t("language.system")} · ${LOCALE_NATIVE_NAMES[language.locale]}` : LOCALE_NATIVE_NAMES[language.locale]} to="/settings/appearance/language" onOpen={onOpen} />
        <SettingsCategoryCard title={t("settings.home.security.title")} description={t("settings.home.security.description")} to="/settings/security" onOpen={onOpen} />
        <SettingsCategoryCard title={t("settings.home.accountData.title")} description={t("settings.home.accountData.description")} to="/settings/account-data" onOpen={onOpen} />
        {isAdmin ? (
          <SettingsCategoryCard
            title={t("settings.home.admin.title")}
            description={t("settings.home.admin.description")}
            to="/admin"
            onOpen={onOpen}
          />
        ) : null}
      </ListGroup>
      <ListGroup>
        <SettingsCategoryCard title={t("settings.home.about.title")} description={t("settings.home.about.description")} to="/about" onOpen={onOpen} />
      </ListGroup>
    </div>
  );
}

export function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = useAdminEntry(user?.accountNumber);
  const { t } = useI18n();
  return (
    <InnerPage title={t("settings.home.title")} backTo="/me">
      <SettingsHome isAdmin={isAdmin} onOpen={(to) => { void navigate(to); }} />
    </InnerPage>
  );
}
