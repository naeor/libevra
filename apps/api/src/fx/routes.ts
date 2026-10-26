import type { FastifyInstance, FastifyRequest } from "fastify";
import { fxDate } from "../../../../packages/shared/src/fx.js";
import type { FxHistoryService } from "../../../../packages/shared/src/fxHistory.js";

/** 未挂载到 app。只提供公共汇率，不接受金额/账号/账本，不读取任何财务表。 */
export async function registerFxRoutes(app: FastifyInstance, options: {
  requireAuth: (request: FastifyRequest) => Promise<void>;
  service: FxHistoryService;
}): Promise<void> {
  app.get("/api/v1/fx/rates", { preHandler: options.requireAuth }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some(key => key !== "date") || typeof query["date"] !== "string" || !fxDate(query["date"])) {
      return reply.code(400).send({ error: "invalid_fx_date" });
    }
    return options.service.lookup(query["date"]);
  });
}
