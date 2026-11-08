import type { Messages } from "../../types.js";
import type zh from "../zh-CN/settings.js";

/** `settings` (English). Must mirror zh-CN key for key. */
const settings: Messages<typeof zh> = {
  home: {
    title: "Settings",
    preferences: { title: "Entry preferences", description: "Default currency, duplicate detection and currency conversion" },
    appearance: { title: "Display & data", description: "Language, theme and currency conversion" },
    security: { title: "Account & security", description: "Password, recovery code and invite codes" },
    accountData: { title: "Your data", description: "Export, delete data or close your account" },
    admin: { title: "Administration", description: "Platform overview, accounts, invite codes and activity log" },
    about: { title: "About Libevra", description: "Version, open-source license and privacy" },
  },
  comingLater: "Coming later",
  saved: "Saved.",
  preferences: {
    title: "Entry preferences",
    defaultCurrency: "Default currency",
    defaultCurrencyHint: "Shown first in currency lists.",
    duplicates: "Duplicate detection",
    entryAndLayout: "Entry & layout",
    largeKeypad: { label: "Large keypad for amounts", hint: "Use the app’s large number pad" },
    reuseLast: { label: "Reuse last entry", hint: "Prefill new entries with the category and details you used last" },
    startRecording: { label: "Start an entry after sign-in", hint: "Skip the entries page and go straight to adding one" },
    currencyOrder: { label: "Currency order", hint: "Your default currency always comes first" },
    buttonPosition: { label: "Main button position", hint: "Left hand / right hand" },
  },
  appearance: {
    title: "Display & data",
    theme: { label: "Appearance", hint: "Theme color, wallpaper and visual style" },
    exchange: { label: "Currency conversion", hint: "Convert every currency into one for statistics" },
  },
  security: {
    title: "Account & security",
    password: { label: "Change password", hint: "Other devices will be signed out" },
    recoveryCode: { label: "New recovery code", hint: "Your current recovery code stops working right away" },
    referral: { label: "Invite codes", hint: "For account registration; does not grant ledger access" },
  },
  theme: {
    title: "Appearance",
    previews: "Theme preview",
    mode: "Mode",
    modes: { system: "System", light: "Light", dark: "Dark" },
    palette: "Theme color",
    palettes: {
      green: "Forest",
      yellow: "Honey",
      orange: "Walnut",
      blue: "Mist",
      purple: "Dusk",
      red: "Ember",
      cyan: "Celadon",
    },
    switchTo: "Use {{name}}",
  },
  wallpaper: {
    title: "Wallpaper", aurora: "Soft aurora", luminous: "Clear light", quiet: "Quiet gradient",
    note: "Previews follow your theme color and visual style. Your selection is saved on this device.",
  },
  glass: {
    title: "Glass effects", style: "Visual style", styles: { original: "Classic", b2: "Layered glass" },
    phoneLight: "Layered glass applies to the light interface on phones.", saved: "Applied immediately and saved for this account on this device. Switching ledgers keeps your choice.",
    presets: {
      clear: { name: "Clear", note: "Show more of the environment behind the glass." },
      balanced: { name: "Balanced", note: "Balance translucency with readable content." },
      soft: { name: "Soft", note: "A softer background and glass finish." },
    },
    custom: "Current: Custom", advanced: "B2 advanced glass settings", reset: "Reset to Balanced",
    accountOnly: "Affects only this account on this device. Higher values mean more transparency for the first three controls and more blur for the last.",
    fields: { ambient: "Previous page visibility", content: "Content glass transparency", chrome: "Chrome glass transparency", blur: "Glass blur" },
    denied: "Administrator access could not be confirmed. This change was not saved.",
  },
  preview: {
    spaceLabel: "Ledger home preview",
    slogan: "Bookkeeping, your way.",
    detailLabel: "Entries page preview",
    summary: "CNY · Spent this month",
    inflow: "In ¥18,000.00",
    balance: "Net ¥16,743.00",
    secondCurrency: "USD",
    moreCurrencies: "More",
    expense: "Expense",
    income: "Income",
    dayHeading: "Today · Oct 24",
    lunch: "Food & drink · Lunch",
    lunchMeta: "12:30 · WeChat Pay",
    shopping: "Shopping · Groceries",
    shoppingMeta: "10:12 · Alipay",
    tabs: { entries: "Entries", insights: "Insights", ledger: "Ledger", me: "Me" },
  },
};

export default settings;
