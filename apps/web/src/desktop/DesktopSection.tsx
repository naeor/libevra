/**
 * 电脑版里没有专门桌面页面的地址，按分组放进合适的外框：
 *
 * - **设置**：固定的设置分类栏 + 具体设置内容（不另加辅助栏）。分类按项目现有设置组织，不新造设置项。
 * - **账本详情**：左侧资料、右侧设置与单人账本历史 / 邀请。
 * - **成员与协作**：共享账本页头成员摘要，左侧编辑记录、右侧独立留言。
 * - 其它页面直接放进主展示区，用桌面工具栏代替手机返回栏。
 */
import { Link, Navigate, useLocation } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { DesktopBookPage } from "./DesktopBookPage.js";
import { DesktopCollabPage } from "./DesktopCollabPage.js";
import { useI18n } from "../i18n/index.js";
import { useAdminEntry } from "../lib/admin.js";
import { useGuestMode } from "../lib/guest/session.js";
import { activeSettingsItem, sectionFor, settingsItems } from "./sections.js";
import { DesktopSurfaceProvider } from "./surface.js";

export function DesktopSection({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation();
  const section = sectionFor(pathname);
  const { user } = useAuth();
  const bookMatch = /^\/books\/([^/]+)(?:\/settings(?:\/.*)?)?$/.exec(pathname);
  if (user !== null && bookMatch?.[1]) return <DesktopBookPage bookId={bookMatch[1]}>{children}</DesktopBookPage>;
  if (section === "settings") return <SettingsChrome>{children}</SettingsChrome>;
  if (section === "collab" && user !== null && ["/ledger", "/ledger/history", "/ledger/messages", "/ledger/invite", "/ledger/members"].includes(pathname)) return <DesktopCollabPage />;
  return <div className="lv-desk-scroll h-full overflow-y-auto">{children}</div>;
}

function SettingsChrome({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const guest = useGuestMode();
  const admin = useAdminEntry(user?.accountNumber);
  const items = settingsItems({ guest, admin });
  const active = activeSettingsItem(items, pathname);

  // 电脑版的「我的」就是设置：账户用户进来直接看到个人资料与左侧分类。
  if (!guest && (pathname === "/me" || pathname === "/settings")) return <Navigate to="/profile" replace />;

  const top = items.some((item) => item.to === pathname);

  return (
    <div className="lv-desk-settings">
      <nav className="lv-desk-settings-nav" aria-label={t("desktop.settings.nav")}>
        <p className="px-3 pt-6 pb-3 text-page-title text-ink">{t("desktop.settings.title")}</p>
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <Link to={item.to} className="lv-desk-settings-item" aria-current={active === item.id ? "page" : undefined}>
                {t(`desktop.settings.items.${item.id}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="lv-desk-settings-content">
        {/* 分类本身的页面只显示标题；更深一层的子页面（主题、头像、某个月的下载）带返回。 */}
        <DesktopSurfaceProvider surface="main" bar={top ? "heading" : "toolbar"}>
          {children}
        </DesktopSurfaceProvider>
      </div>
    </div>
  );
}
