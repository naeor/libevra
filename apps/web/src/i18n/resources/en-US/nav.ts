import type { Messages } from "../../types.js";
import type zh from "../zh-CN/nav.js";

/** `nav` (English). Must mirror zh-CN key for key. */
const nav: Messages<typeof zh> = {
  tabs: {
    entries: "Entries",
    insights: "Insights",
    add: "Add",
    ledger: "Ledger",
    shared: "Shared",
    me: "Me",
  },
  mainNav: "Main navigation",
  entry: {
    paste: { label: "Paste text", short: "Paste" },
    voice: { label: "Voice entry", short: "Voice" },
    manual: { label: "Manual entry", short: "Manual" },
    scan: { label: "Scan a receipt", short: "Scan" },
    import: { label: "Import a statement", short: "Import" },
    needsAccount: "{{label}}, needs a full account",
    unavailable: "{{label}}, {{reason}}",
    comingSoon: "coming soon",
    expand: "Show ways to add",
    collapse: "Hide ways to add",
  },
  page: {
    nav: "Page navigation",
    back: "Back",
  },
  state: {
    loadFailed: "Couldn’t load",
    retry: "Try again",
  },
  message: {
    collapse: "Show less",
    expand: "Show more",
    dismiss: "Dismiss",
  },
  copy: {
    copy: "Copy",
    copied: "Copied",
    manual: "Long-press to copy",
  },
  sheet: {
    close: "Close {{title}}",
  },
  choice: {
    placeholder: "Not selected",
    current: "{{label}}: {{value}}",
  },
  errorBoundary: {
    title: "This page can’t be shown",
    body: "Something went wrong showing this page. Reload, or go back to Entries.",
    details: "Error details",
    reload: "Reload page",
    home: "Back to Entries",
  },
  splash: "Loading…",
  version: {
    unknown: "(unknown)",
    localTime: "{{time}} (local time, {{zone}})",
  },
};

export default nav;
