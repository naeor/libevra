import type { AdminSelfResponse } from "@libellum/shared";
import { fetchAdminSelf } from "../lib/admin.js";
import type { VisualStyleController } from "../lib/visualStyle.js";
import type { B2GlassValues } from "./b2Glass.js";

/** 高级编辑每次通过已有服务端管理员校验；无新管理员 API、全局设置或账本写入。 */
export function createB2AdminEditor(controller: VisualStyleController, accountId: string, accountNumber: string,
  authorize: () => Promise<AdminSelfResponse | null> = fetchAdminSelf) {
  let revision = 0;
  return {
    cancel(): void { revision++; },
    async choose(values: B2GlassValues): Promise<"saved" | "denied" | "superseded"> {
      const token = ++revision;
      const before = controller.getB2Snapshot();
      let self: AdminSelfResponse | null = null;
      try { self = await authorize(); } catch { /* 离线 / 失败时不能把未确认身份当管理员。 */ }
      if (token !== revision || controller.getB2Account() !== accountId || controller.getB2Snapshot() !== before) return "superseded";
      if (!self?.isAdmin || self.accountNumber !== accountNumber) return "denied";
      return controller.chooseB2Custom(accountId, values) ? "saved" : "superseded";
    },
  };
}
