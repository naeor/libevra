import { createHash } from "node:crypto";
import { CURRENCIES } from "@libellum/shared";
import { fxDate, fxDecimal, type FxSnapshot } from "../../../../packages/shared/src/fx.js";
import { FxError, type FxProvider } from "../../../../packages/shared/src/fxHistory.js";

/** 显式调用才联网；固定单一 ECB 来源，禁止默认 blended 数据混入。 */
export class EcbFrankfurterProvider implements FxProvider {
  readonly id = "ecb-via-frankfurter-v2";
  constructor(private readonly request: typeof fetch = fetch, private readonly now = Date.now,
    private readonly timeoutMs = 5000) {}
  async fetch(date: string): Promise<FxSnapshot> {
    if (!fxDate(date)) throw new FxError("invalid_input");
    const from = new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
    const url = new URL("https://api.frankfurter.dev/v2/providers/ecb/rates");
    url.search = new URLSearchParams({ from, to: date, base: "EUR", quotes: CURRENCIES.filter(c => c !== "EUR").join(",") }).toString();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new FxError("timeout")); }, this.timeoutMs);
      });
      const data = await Promise.race([(async () => {
        const response = await this.request(url, { signal: controller.signal });
        if (!response.ok) throw new FxError(response.status === 404 ? "missing_rate" : response.status === 422 ? "unsupported_currency" : "api_error");
        const body = await response.text();
        if (body.length > 100000) throw new FxError("invalid_rate");
        try {
          // Node >=22 的 JSON source reviver 保留数值字面量，避免先转 double 丢掉上游精度。
          const parse = JSON.parse as (text: string, reviver: (key: string, value: unknown, context: { source?: string }) => unknown) => unknown;
          return parse(body, (key, value, context) => {
            if (key === "rate" && typeof value === "number") {
              if (!context?.source) throw new FxError("invalid_rate");
              return context.source;
            }
            return value;
          });
        } catch { throw new FxError("invalid_rate"); }
      })(), timeout]);
      if (!Array.isArray(data) || data.length > 1000) throw new FxError("invalid_rate");
      const dates = new Map<string, Record<string, string>>();
      for (const row of data as unknown[]) {
        if (!row || typeof row !== "object") throw new FxError("invalid_rate");
        const value = row as Record<string, unknown>;
        const day = value["date"], quote = value["quote"], raw = value["rate"];
        if (typeof day !== "string" || !fxDate(day) || day > date || day < from || value["base"] !== "EUR"
          || typeof quote !== "string" || !(CURRENCIES as readonly string[]).includes(quote) || quote === "EUR"
          || (typeof raw !== "string" && typeof raw !== "number")) throw new FxError("invalid_rate");
        const rate = String(raw);
        try { fxDecimal(rate); } catch { throw new FxError("invalid_rate"); }
        const rates = dates.get(day) ?? { EUR: "1" };
        if (rates[quote] !== undefined && rates[quote] !== rate) throw new FxError("conflict");
        rates[quote] = rate; dates.set(day, rates);
      }
      const actualDate = [...dates.keys()].sort().at(-1);
      if (!actualDate) throw new FxError("missing_rate");
      const rates = dates.get(actualDate)!;
      const revision = createHash("sha256").update(JSON.stringify([this.id, actualDate, Object.entries(rates).sort()])).digest("hex");
      return { base: "EUR", date: actualDate, provider: this.id, revision, fetchedAt: new Date(this.now()).toISOString(), rates };
    } catch (error) {
      if (error instanceof FxError) throw error;
      throw new FxError(controller.signal.aborted ? "timeout" : "network");
    } finally { clearTimeout(timer); }
  }
}
