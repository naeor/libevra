/**
 * **默认币种**（1.19.94，游客模式补齐）。
 *
 * 登录用户的默认币种存在服务器（`user.defaultCurrency`，记账偏好页改）；游客没有服务器，原来一律当 CNY，
 * 而且散在各页面里写死 `user?.defaultCurrency ?? "CNY"`。现在统一从这里取：
 * - 登录用户：`user.defaultCurrency`；
 * - 游客：存在本机 `libevra.guest-default-currency:<游客 id>`（随“清除游客数据”一起清，见 `deviceStorageKeys.ts` 的 `clearOwnerPreferences`）；
 * - 都没有：CNY。
 */
import { useSyncExternalStore } from "react";
import { currencySchema, type Currency } from "@libellum/shared";

import { useAuthOptional } from "../auth/AuthProvider.js";
import { useGuestIdentity } from "./guest/session.js";

const GUEST_DEFAULT_CURRENCY_PREFIX = "libevra.guest-default-currency:";
const listeners = new Set<() => void>();

export function guestDefaultCurrencyKey(guestId: string): string {
  return `${GUEST_DEFAULT_CURRENCY_PREFIX}${guestId}`;
}

export function readGuestDefaultCurrency(guestId: string): Currency | null {
  try {
    const parsed = currencySchema.safeParse(localStorage.getItem(guestDefaultCurrencyKey(guestId)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function setGuestDefaultCurrency(guestId: string, currency: Currency): void {
  try {
    localStorage.setItem(guestDefaultCurrencyKey(guestId), currency);
  } catch {
    /* 隐私模式可能拒绝写入；本次会话里仍按原值显示。 */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const storage = (event: StorageEvent): void => { if (event.key?.startsWith(GUEST_DEFAULT_CURRENCY_PREFIX) === true) listener(); };
  if (typeof window !== "undefined") window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", storage);
  };
}

/** 当前身份的默认币种：登录用户取账号设置，游客取本机设置，都没有时 CNY。 */
export function useDefaultCurrency(): Currency {
  // 组件测试可能不在 <AuthProvider> 里渲染；没有会话时按游客/默认值处理。
  const user = useAuthOptional()?.user ?? null;
  const guestId = useGuestIdentity()?.id ?? null;
  const guestCurrency = useSyncExternalStore(subscribe, () => (guestId === null ? null : readGuestDefaultCurrency(guestId)), () => null);
  if (user) return user.defaultCurrency;
  return guestCurrency ?? "CNY";
}
