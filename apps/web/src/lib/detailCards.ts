import { useEffect, useState, useSyncExternalStore } from "react";
import { detailCardSchema, mainDetailMetrics, isDetailChart, type DetailCardConfiguration } from "@libellum/shared";
import { syncDetailCards, type CardLocal } from "./detailCardSync.js";
import { useViewBookId } from "./workspaceLedger.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useGuestIdentity } from "./guest/session.js";
export { mainDetailMetrics, isDetailChart };
export const MAIN_CARDS = ["overview", "expense", "income"] as const;
export const SMALL_CARDS = ["balance", "daily", "expense", "income", "count"] as const;
export type DetailCards = DetailCardConfiguration;
export const DEFAULT_DETAIL_CARDS: DetailCards = { main: "overview", first: "balance", second: "daily" };
export function parseDetailCards(raw: string | null): DetailCards {
  try { const v = JSON.parse(raw ?? "{}"); if (detailCardSchema.safeParse(v).success) return detailCardSchema.parse(v); return {
    main: MAIN_CARDS.includes(v?.main) ? v.main : DEFAULT_DETAIL_CARDS.main,
    first: SMALL_CARDS.includes(v?.first) ? v.first : DEFAULT_DETAIL_CARDS.first,
    second: SMALL_CARDS.includes(v?.second) ? v.second : DEFAULT_DETAIL_CARDS.second,
  }; } catch { return { ...DEFAULT_DETAIL_CARDS }; }
}
const listen = (fn: () => void) => { window.addEventListener("storage", fn); window.addEventListener("detail-cards", fn); return () => { window.removeEventListener("storage", fn); window.removeEventListener("detail-cards", fn); }; };
export function useDetailCards(owner: string) {
  const book = useViewBookId(), { user } = useAuth(), guest = useGuestIdentity();
  const key = "libevra.detail-cards.v2." + owner + "." + (book ?? "local");
  const [syncError, setSyncError] = useState(false);
  const readRaw = () => { try { return localStorage.getItem(key); } catch { return null; } };
  useSyncExternalStore(listen, readRaw, () => null);
  const read = (): CardLocal => {
    const stored = readRaw();
    if (stored) {
      const v = JSON.parse(stored) as CardLocal;
      detailCardSchema.parse(v.value);
      if (!Number.isSafeInteger(v.base) || v.base < 0 || typeof v.dirty !== "boolean") throw Error("Invalid configuration");
      return v;
    }
    const old = localStorage.getItem("libevra.detail-cards.v1." + owner);
    return { value: parseDetailCards(old), base: 0, dirty: old !== null };
  };
  let local: CardLocal, invalid = false;
  try { local = read(); } catch { local = { value: DEFAULT_DETAIL_CARDS, base: 0, dirty: false }; invalid = true; }
  const write = (v: CardLocal) => {
    const next = JSON.stringify(v);
    if (readRaw() === next) return;
    localStorage.setItem(key, next); window.dispatchEvent(new Event("detail-cards"));
  };
  useEffect(() => {
    if (!book || guest || !user || user.id !== owner || invalid) return;
    let active = true, busy = false, again = false;
    const run = async () => {
      if (!navigator.onLine || !active) return;
      if (busy) { again = true; return; }
      busy = true;
      try { await syncDetailCards(owner, book, read, write, () => active); if (active) setSyncError(false); }
      catch { if (active) setSyncError(true); }
      finally { busy = false; if (again && active) { again = false; void run(); } }
    };
    const timer = window.setTimeout(() => void run(), 300);
    const interval = window.setInterval(() => void run(), 60000);
    const retry = () => void run();
    window.addEventListener("online", retry); window.addEventListener("focus", retry); window.addEventListener("detail-cards", retry); window.addEventListener("storage", retry);
    return () => { active = false; clearTimeout(timer); clearInterval(interval); window.removeEventListener("online", retry); window.removeEventListener("focus", retry); window.removeEventListener("detail-cards", retry); window.removeEventListener("storage", retry); };
  }, [owner, book, user?.id, guest?.id, key, invalid]);
  return { value: local.value, dirty: local.dirty, conflict: local.conflict, syncError, invalid,
    save: (value: DetailCards) => {
      if (invalid || !book && !guest) return false;
      try { const previous = read(); write({ ...previous, value: detailCardSchema.parse(value), dirty: true }); return true; } catch { return false; }
    },
    resolve: (choice: "local" | "remote") => {
      try { const latest = read(); if (!latest.conflict) return true;
        write({ value: choice === "local" ? latest.value : latest.conflict.configuration, base: latest.conflict.version, dirty: choice === "local" });
        return true;
      } catch { return false; }
    },
  };
}
/** 当前月份计至今天；全部时间未指定范围时不推断天数。 */
export function detailDayCount(month: string, from: string, to: string, today: string): number | null {
  const start = from || (/^\d{4}-\d{2}$/.test(month) ? month + "-01" : "");
  const end = to || (/^\d{4}-\d{2}$/.test(month) ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10) : "");
  if (!start || !end || start > today) return null;
  const days = (Date.parse((end > today ? today : end) + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000 + 1;
  return Number.isInteger(days) && days > 0 ? days : null;
}
export function dailyMinor(amount: string, days: number): string {
  const n = BigInt(amount), d = BigInt(days);
  return ((n + d / 2n) / d).toString();
}
