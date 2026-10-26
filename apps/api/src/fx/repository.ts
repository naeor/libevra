import type { Pool } from "pg";
import { validateSnapshot, rateAge } from "../../../../packages/shared/src/fx.js";
import { FxError, type FxRepository, type FxStored } from "../../../../packages/shared/src/fxHistory.js";

/** 仅接受已配置的本地/服务器 Pool，不自行读取凭据或连接生产。 */
export class PgFxRepository implements FxRepository {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}
  async get(provider: string, requestedDate: string): Promise<FxStored | null> {
    const result = await this.pool.query<{
      rate_date: string; revision: string; base: "EUR"; rates: Record<string, string>; fetched_at: Date; checked_at: Date;
    }>(`SELECT s.rate_date::text, s.revision, s.base, s.rates, s.fetched_at, r.checked_at
      FROM fx_resolutions r JOIN LATERAL (
        SELECT * FROM fx_snapshots s WHERE s.provider=r.provider AND s.rate_date=r.rate_date
        ORDER BY fetched_at DESC LIMIT 1
      ) s ON true WHERE r.provider=$1 AND r.requested_date=$2::date`, [provider, requestedDate]);
    const row = result.rows[0];
    return row ? { snapshot: { base: row.base, date: row.rate_date, provider, revision: row.revision,
      rates: row.rates, fetchedAt: row.fetched_at.toISOString() }, checkedAt: row.checked_at.toISOString() } : null;
  }
  async save(provider: string, requestedDate: string, value: FxStored): Promise<void> {
    const s = value.snapshot;
    validateSnapshot(s);
    if (s.provider !== provider || rateAge(requestedDate, s.date) < 0 || rateAge(requestedDate, s.date) > 7) throw new FxError("invalid_rate");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // 跨进程并发同一来源写入串行化，防止同 revision 冲突与旧抓取覆盖新抓取。
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`fx:${provider}`]);
      const conflict = await client.query(`SELECT 1 FROM fx_snapshots WHERE provider=$1 AND rate_date=$2::date
        AND ((revision=$3 AND rates <> $4::jsonb) OR fetched_at > $5::timestamptz
          OR (fetched_at=$5::timestamptz AND revision<>$3)) LIMIT 1`,
      [provider, s.date, s.revision, JSON.stringify(s.rates), s.fetchedAt]);
      if (conflict.rowCount) throw new FxError("conflict");
      await client.query(`INSERT INTO fx_snapshots(provider,rate_date,revision,base,rates,fetched_at)
        VALUES ($1,$2::date,$3,$4,$5::jsonb,$6::timestamptz)
        ON CONFLICT(provider,rate_date,revision) DO UPDATE SET fetched_at=EXCLUDED.fetched_at`,
      [provider, s.date, s.revision, s.base, JSON.stringify(s.rates), s.fetchedAt]);
      await client.query(`INSERT INTO fx_resolutions(provider,requested_date,rate_date,checked_at)
        VALUES ($1,$2::date,$3::date,$4::timestamptz)
        ON CONFLICT(provider,requested_date) DO UPDATE SET rate_date=EXCLUDED.rate_date,checked_at=EXCLUDED.checked_at
        WHERE fx_resolutions.checked_at <= EXCLUDED.checked_at`, [provider, requestedDate, s.date, value.checkedAt]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
