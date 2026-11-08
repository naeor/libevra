/**
 * 电脑版按地址把页面分组：设置类页面放在「设置分类 + 内容」里，账本协作类页面放在「协作分页」里，
 * 其它页面直接放进主展示区。
 */
export type DesktopSection = "settings" | "collab" | "plain";

const SETTINGS_PREFIXES = ["/settings", "/profile", "/downloads", "/update", "/admin"];
const SETTINGS_EXACT = ["/me", "/about", "/legal/privacy", "/legal/terms"];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function sectionFor(pathname: string): DesktopSection {
  if (pathname === "/ledger/cards") return "plain";
  if (SETTINGS_EXACT.includes(pathname) || SETTINGS_PREFIXES.some((prefix) => under(pathname, prefix))) return "settings";
  // `/ledger/more` 是记账流程的一部分，不放进协作分页。
  if (under(pathname, "/ledger") && pathname !== "/ledger/more") return "collab";
  return "plain";
}

export type SettingsItemId =
  | "profile"
  | "preferences"
  | "appearance"
  | "language"
  | "security"
  | "accountData"
  | "downloads"
  | "updates"
  | "admin"
  | "about"
  | "guestHome";

export interface SettingsItem {
  readonly id: SettingsItemId;
  readonly to: string;
  /** 这一项负责的其它地址（子页面），用于标出当前项。 */
  readonly prefixes: readonly string[];
}

export function settingsItems(options: { readonly guest: boolean; readonly admin: boolean }): readonly SettingsItem[] {
  if (options.guest) {
    return [
      { id: "guestHome", to: "/me", prefixes: ["/me"] },
      { id: "language", to: "/settings/appearance/language", prefixes: ["/settings"] },
    ];
  }
  return [
    { id: "profile", to: "/profile", prefixes: ["/profile", "/me"] },
    { id: "preferences", to: "/settings/preferences", prefixes: ["/settings/preferences"] },
    { id: "appearance", to: "/settings/appearance/theme", prefixes: ["/settings/appearance"] },
    { id: "language", to: "/settings/appearance/language", prefixes: ["/settings/appearance/language"] },
    { id: "security", to: "/settings/security", prefixes: ["/settings/security", "/settings/password", "/settings/recovery-code", "/settings/referral-codes"] },
    { id: "accountData", to: "/settings/account-data", prefixes: ["/settings/account-data"] },
    { id: "downloads", to: "/downloads", prefixes: ["/downloads"] },
    { id: "updates", to: "/update", prefixes: ["/update"] },
    ...(options.admin ? [{ id: "admin" as const, to: "/admin", prefixes: ["/admin"] }] : []),
    { id: "about", to: "/about", prefixes: ["/about", "/legal"] },
  ];
}

/** 当前地址对应的设置项：取匹配到的最长前缀，`/settings` 本身归到第一项。 */
export function activeSettingsItem(items: readonly SettingsItem[], pathname: string): SettingsItemId | null {
  let best: { readonly id: SettingsItemId; readonly length: number } | null = null;
  for (const item of items) {
    for (const prefix of item.prefixes) {
      if (under(pathname, prefix) && (best === null || prefix.length > best.length)) best = { id: item.id, length: prefix.length };
    }
  }
  return best?.id ?? null;
}

export type CollabTabId = "overview" | "messages" | "members" | "invite" | "history";

export const COLLAB_TABS: readonly { readonly id: CollabTabId; readonly to: string }[] = [
  { id: "overview", to: "/ledger" },
  { id: "messages", to: "/ledger/messages" },
  { id: "members", to: "/ledger/members" },
  { id: "invite", to: "/ledger/invite" },
  { id: "history", to: "/ledger/history" },
];

export function activeCollabTab(pathname: string): CollabTabId {
  const match = [...COLLAB_TABS].reverse().find((tab) => tab.to !== "/ledger" && under(pathname, tab.to));
  return match?.id ?? "overview";
}
