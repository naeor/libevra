/**
 * 电脑版里没有专门桌面页面的地址，按分组放进合适的外框：
 *
 * - **设置**：固定的设置分类栏 + 具体设置内容（不另加辅助栏）。分类按项目现有设置组织，不新造设置项。
 * - **成员与协作**：顶部分页（概况、留言、成员、邀请、动态）；多人账本时右侧辅助栏放留言，
 *   可以一边看成员与账本信息一边讨论。
 * - 其它页面直接放进主展示区，用桌面工具栏代替手机返回栏。
 */
import { Link, Navigate, useLocation } from "react-router";

import { useAuth } from "../auth/AuthProvider.js";
import { MessageBoardFull } from "../components/MessageBoard.js";
import { useI18n } from "../i18n/index.js";
import { useAdminEntry } from "../lib/admin.js";
import { useGuestMode } from "../lib/guest/session.js";
import { useLedger } from "../lib/queries.js";
import { DesktopSplit } from "./DesktopSplit.js";
import { DesktopToolbar } from "./DesktopToolbar.js";
import { activeCollabTab, activeSettingsItem, COLLAB_TABS, sectionFor, settingsItems } from "./sections.js";
import { DesktopSurfaceProvider } from "./surface.js";

export function DesktopSection({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation();
  const section = sectionFor(pathname);
  if (section === "settings") return <SettingsChrome>{children}</SettingsChrome>;
  if (section === "collab") return <CollabChrome>{children}</CollabChrome>;
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

function CollabChrome({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const ledger = useLedger();
  const active = activeCollabTab(pathname);
  const shared = (ledger.data?.book.memberCount ?? 1) > 1;
  const messagesAside = shared && active !== "messages" && ledger.data !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DesktopToolbar title={t("desktop.collab.title")} meta={ledger.data?.book.name}>
        <nav className="lv-desk-tabs" aria-label={t("desktop.collab.nav")}>
          {COLLAB_TABS.map((tab) => (
            <Link key={tab.id} to={tab.to} className="lv-desk-tab" aria-current={active === tab.id ? "page" : undefined}>
              {t(`desktop.collab.tabs.${tab.id}`)}
            </Link>
          ))}
        </nav>
      </DesktopToolbar>
      <div className="min-h-0 flex-1">
        <DesktopSplit
          whenNarrow="hide"
          panelLabel={t("desktop.collab.messagesPanel")}
          panel={
            messagesAside && ledger.data !== undefined ? (
              <div className="flex h-full min-h-0 flex-col">
                <p className="lv-desk-panel-bar text-section-title text-ink">{t("desktop.collab.messagesPanel")}</p>
                <div className="min-h-0 flex-1">
                  <MessageBoardFull bookName={ledger.data.book.name} />
                </div>
              </div>
            ) : null
          }
        >
          <div className={`lv-desk-scroll h-full ${active === "messages" ? "overflow-hidden" : "overflow-y-auto"}`}>
            <DesktopSurfaceProvider surface="main" bar="none">
              {children}
            </DesktopSurfaceProvider>
          </div>
        </DesktopSplit>
      </div>
    </div>
  );
}
