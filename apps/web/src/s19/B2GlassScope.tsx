import { useLayoutEffect } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { visualStyleRuntime } from "../lib/visualStyle.js";

/** 视觉偏好随真实账号切换，与账本、工作区和服务器账本同步无关。 */
export function B2GlassScope(): null {
  const { user, status } = useAuth();
  useLayoutEffect(() => { visualStyleRuntime()?.setB2Account(status === "ready" ? user?.id ?? null : null); }, [user?.id, status]);
  return null;
}
