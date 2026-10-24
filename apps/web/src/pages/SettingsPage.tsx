import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { InnerPage } from "../components/Layouts.js";
import { ListGroup } from "../components/ui/List.js";
import { SettingsCategoryCard } from "../components/SettingsCard.js";
import { useAdminEntry } from "../lib/admin.js";
import { useI18n } from "../i18n/index.js";

/** 设置首页只负责导航；默认币种仍由记账偏好页面的原 hook 管理。 */
export function SettingsHome({ isAdmin, onOpen }: {
  readonly isAdmin: boolean;
  readonly onOpen: (to: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <ListGroup>
        <SettingsCategoryCard title={t("settings.home.preferences.title")} description={t("settings.home.preferences.description")} to="/settings/preferences" onOpen={onOpen} />
        <SettingsCategoryCard title={t("settings.home.appearance.title")} description={t("settings.home.appearance.description")} to="/settings/appearance" onOpen={onOpen} />
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
