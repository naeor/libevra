import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";

const context = new AsyncLocalStorage<FastifyRequest>();

/** 保留本次请求上下文；不改变身份或账本权限判断。 */
export function registerAuditContext(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => context.run(request, done));
}

export function currentAuditContext(): { sourceIp: string | null; operationId: string | null } {
  const request = context.getStore();
  if (!request) return { sourceIp: null, operationId: null };
  const peer = request.raw.socket.remoteAddress ?? "";
  // 只有运维明确列出的直连代理才可提供来源地址；不沿用 trustProxy:true 的无条件信任。
  const proxies = (process.env["AUDIT_TRUSTED_PROXY_IPS"] ?? "").split(",").map((s) => s.trim());
  const forwarded = request.headers["x-forwarded-for"];
  const candidate = proxies.includes(peer) && typeof forwarded === "string"
    ? forwarded.split(",").at(-1)?.trim() ?? peer : peer;
  return { sourceIp: isIP(candidate) ? candidate : null, operationId: request.id.slice(0, 128) };
}
