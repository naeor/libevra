import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { EcbFrankfurterProvider } from "./provider.js";

/** 仅显式 --live 才发公共查询；串行、无凭据、不上传业务数据。原文样本用于离线回归。 */
if (!process.argv.includes("--live")) throw new Error("真实请求需显式传 --live");
const root = "https://api.frankfurter.dev";
const records: { name: string; url: string; status: number | null; elapsedMs: number; body: string; error?: string }[] = [];
async function capture(name: string, path: string, signal?: AbortSignal | null) {
  const url = path.startsWith("https://") ? path : root + path, start = performance.now();
  if (!["api.frankfurter.dev", "data-api.ecb.europa.eu"].includes(new URL(url).hostname)) throw new Error("unexpected_public_host");
  try {
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    const body = await response.text();
    records.push({ name, url, status: response.status, elapsedMs: Math.round(performance.now() - start), body });
    let summary: unknown;
    try { const parsed = JSON.parse(body); summary = Array.isArray(parsed) ? { rows: parsed.length, dates: [...new Set(parsed.map((r: { date: string }) => r.date))], sample: parsed.slice(0, 2).map(({ providers, ...row }) => row) } : name === "provider" ? { ...parsed, currencies: parsed.currencies?.filter((c: string) => ["USD","EUR","CNY","JPY","HKD","GBP"].includes(c)) } : parsed; }
    catch { summary = body.slice(0, 180); }
    console.log(JSON.stringify({ name, status: response.status, elapsedMs: Math.round(performance.now() - start), summary }));
    return body;
  } catch (error) {
    const reason = error instanceof Error ? error.name + ": " + error.message : "network";
    records.push({ name, url, status: null, elapsedMs: Math.round(performance.now() - start), body: "", error: reason });
    console.log(JSON.stringify({ name, error: reason }));
    return null;
  }
}
const quotes = "USD,CNY,JPY,HKD,GBP";
const directory = new URL("./fixtures/live-20261026/", import.meta.url);
const repairCheck = process.argv.includes("--repair-check");
if (process.argv.includes("--adapter-only") || repairCheck) {
  const previous = JSON.parse(await readFile(new URL("requests.json", directory), "utf8"));
  records.push(...previous.records);
} else {
await capture("provider", "/v2/providers/ecb");
for (const [name, date] of [["weekday", "2024-05-15"], ["weekend", "2024-05-19"], ["holiday", "2024-12-25"], ["early", "1999-01-04"]]) {
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  await capture(name!, `/v2/providers/ecb/rates?from=${from}&to=${date}&base=EUR&quotes=${quotes}`);
}
await capture("latest", `/v2/providers/ecb/rates?base=EUR&quotes=${quotes}`);
await capture("missing", `/v2/providers/ecb/rates?from=1989-12-25&to=1990-01-01&base=EUR&quotes=${quotes}`);
await capture("unsupported", "/v2/providers/ecb/rates?date=2024-05-15&base=EUR&quotes=ABC");
await capture("usd-base", "/v2/providers/ecb/rates?date=2024-05-15&base=USD&quotes=EUR,CNY,JPY,HKD,GBP");
await capture("blended", `/v2/rates?date=2024-05-15&base=EUR&quotes=${quotes}&expand=providers`);
await capture("v1", "/v1/2024-05-15?base=EUR&symbols=USD,CNY,JPY,HKD,GBP");
}
const provider = new EcbFrankfurterProvider(async (url, init) => {
  const body = await capture(repairCheck ? "adapter-weekend-fixed" : "adapter-recent", String(url), init?.signal);
  const last = records.at(-1)!;
  if (last.status === null) throw new Error(last.error);
  return new Response(body, { status: last.status });
});
let adapterPassed = false;
try { console.log(JSON.stringify({ adapterSnapshot: await provider.fetch(repairCheck ? "2024-05-19" : "2026-10-23") })); adapterPassed = true; }
catch (error) { console.log(JSON.stringify({ adapterError: error instanceof Error ? error.message : "network" })); }
if (repairCheck) await capture("coverage-cny", "/v2/coverage?base=EUR&quotes=CNY&providers=ECB");
else await capture("ecb-official", "https://data-api.ecb.europa.eu/service/data/EXR/D.USD+CNY+JPY+HKD+GBP.EUR.SP00.A?startPeriod=2024-05-15&endPeriod=2024-05-15&format=csvdata");
await mkdir(directory, { recursive: true });
await writeFile(new URL("requests.json", directory), JSON.stringify({ capturedAt: new Date().toISOString(), records }, null, 2) + "\n");
console.log(`已保存 ${records.length} 次公共请求的原文与状态`);
if (!adapterPassed) process.exitCode = 1;
