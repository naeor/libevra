import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider.js";
import { InnerPage } from "../components/Layouts.js";
import { ListGroup } from "../components/ui/List.js";
import { SettingsCategoryCard } from "../components/SettingsCard.js";
import { useAdminEntry } from "../lib/admin.js";

/** 设置首页只负责导航；默认币种仍由记账偏好页面的原 hook 管理。 */
export function SettingsHome({ isAdmin, onOpen }: {
  readonly isAdmin: boolean;
  readonly onOpen: (to: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <ListGroup>
        <SettingsCategoryCard title="记账偏好" description="默认币种、重复提醒与录入习惯" to="/settings/preferences" onOpen={onOpen} />
        <SettingsCategoryCard title="显示与数据" description="语言、主题与汇率显示" to="/settings/appearance" onOpen={onOpen} />
        <SettingsCategoryCard title="账号与安全" description="密码、恢复码与邀请码" to="/settings/security" onOpen={onOpen} />
        <SettingsCategoryCard title="账号与数据" description="导出、删除数据与注销账号" to="/settings/account-data" onOpen={onOpen} />
        {isAdmin ? (
          <SettingsCategoryCard
            title="系统管理"
            description="平台概览、账号、邀请码与操作记录"
            to="/admin"
            onOpen={onOpen}
          />
        ) : null}
      </ListGroup>
      <ListGroup>
        <SettingsCategoryCard title="关于 Libevra" description="版本信息、开源协议与隐私说明" to="/about" onOpen={onOpen} />
      </ListGroup>
    </div>
  );
}

export function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = useAdminEntry(user?.accountNumber);
  return (
    <InnerPage title="设置" backTo="/me">
      <SettingsHome isAdmin={isAdmin} onOpen={(to) => { void navigate(to); }} />
    </InnerPage>
  );
}
