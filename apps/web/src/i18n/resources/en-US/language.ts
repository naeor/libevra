import type { Messages } from "../../types.js";
import type zh from "../zh-CN/language.js";

/** `language` (English). Must mirror zh-CN key for key. */
const language: Messages<typeof zh> = {
  title: "Language",
  rowHint: "简体中文 / English",
  pageTitle: "Language / 语言",
  system: "Use device language",
  systemHint: "Follows your browser or system language. Currently {{language}}.",
  current: "Current: {{language}}",
  note: "Only the app’s text changes. Your entries, category names, notes and currencies stay as they are.",
  switchTo: "Switch to {{language}}",
  switchLabel: "Display language",
};

export default language;
