/**
 * 全部文案资源的装配点。
 *
 * ⚠️ **两种语言都打进主包，不做按需加载。** Libevra 是离线优先的 PWA：语言包若拆成单独的
 * chunk，第一次离线打开英文界面时就可能因为那个 chunk 没被缓存而退回中文甚至报错。
 * 两份文案合计只有几十 KB（gzip 后更小），换来的是任何时候切换都即时、离线也可用。
 */
import enAccount from "./en-US/account.js";
import enAdmin from "./en-US/admin.js";
import enAnnouncements from "./en-US/announcements.js";
import enAuth from "./en-US/auth.js";
import enBooks from "./en-US/books.js";
import enCapture from "./en-US/capture.js";
import enCollab from "./en-US/collab.js";
import enCommon from "./en-US/common.js";
import enDataio from "./en-US/dataio.js";
import enDuplicates from "./en-US/duplicates.js";
import enEntry from "./en-US/entry.js";
import enErrors from "./en-US/errors.js";
import enFormat from "./en-US/format.js";
import enLanguage from "./en-US/language.js";
import enLedger from "./en-US/ledger.js";
import enLedgerImport from "./en-US/ledgerImport.js";
import enLegal from "./en-US/legal.js";
import enManage from "./en-US/manage.js";
import enNav from "./en-US/nav.js";
import enOcr from "./en-US/ocr.js";
import enOffline from "./en-US/offline.js";
import enPresets from "./en-US/presets.js";
import enSettings from "./en-US/settings.js";
import enStats from "./en-US/stats.js";
import enUpdate from "./en-US/update.js";
import zhAccount from "./zh-CN/account.js";
import zhAdmin from "./zh-CN/admin.js";
import zhAnnouncements from "./zh-CN/announcements.js";
import zhAuth from "./zh-CN/auth.js";
import zhBooks from "./zh-CN/books.js";
import zhCapture from "./zh-CN/capture.js";
import zhCollab from "./zh-CN/collab.js";
import zhCommon from "./zh-CN/common.js";
import zhDataio from "./zh-CN/dataio.js";
import zhDuplicates from "./zh-CN/duplicates.js";
import zhEntry from "./zh-CN/entry.js";
import zhErrors from "./zh-CN/errors.js";
import zhFormat from "./zh-CN/format.js";
import zhLanguage from "./zh-CN/language.js";
import zhLedger from "./zh-CN/ledger.js";
import zhLedgerImport from "./zh-CN/ledgerImport.js";
import zhLegal from "./zh-CN/legal.js";
import zhManage from "./zh-CN/manage.js";
import zhNav from "./zh-CN/nav.js";
import zhOcr from "./zh-CN/ocr.js";
import zhOffline from "./zh-CN/offline.js";
import zhPresets from "./zh-CN/presets.js";
import zhSettings from "./zh-CN/settings.js";
import zhStats from "./zh-CN/stats.js";
import zhUpdate from "./zh-CN/update.js";
import type { Messages } from "../types.js";

export const zhCN = {
  common: zhCommon,
  language: zhLanguage,
  format: zhFormat,
  presets: zhPresets,
  errors: zhErrors,
  auth: zhAuth,
  account: zhAccount,
  legal: zhLegal,
  nav: zhNav,
  ledger: zhLedger,
  entry: zhEntry,
  stats: zhStats,
  books: zhBooks,
  manage: zhManage,
  capture: zhCapture,
  ocr: zhOcr,
  duplicates: zhDuplicates,
  ledgerImport: zhLedgerImport,
  dataio: zhDataio,
  offline: zhOffline,
  collab: zhCollab,
  settings: zhSettings,
  update: zhUpdate,
  admin: zhAdmin,
  announcements: zhAnnouncements,
};

export type TranslationResource = typeof zhCN;

export const enUS: Messages<TranslationResource> = {
  common: enCommon,
  language: enLanguage,
  format: enFormat,
  presets: enPresets,
  errors: enErrors,
  auth: enAuth,
  account: enAccount,
  legal: enLegal,
  nav: enNav,
  ledger: enLedger,
  entry: enEntry,
  stats: enStats,
  books: enBooks,
  manage: enManage,
  capture: enCapture,
  ocr: enOcr,
  duplicates: enDuplicates,
  ledgerImport: enLedgerImport,
  dataio: enDataio,
  offline: enOffline,
  collab: enCollab,
  settings: enSettings,
  update: enUpdate,
  admin: enAdmin,
  announcements: enAnnouncements,
};
