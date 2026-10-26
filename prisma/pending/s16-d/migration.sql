-- 待集成迁移：只新增公共参考数据。未加入主 migrations，未应用开发/生产库。
CREATE TABLE fx_snapshots (
  provider text NOT NULL,
  rate_date date NOT NULL,
  revision text NOT NULL,
  base varchar(3) NOT NULL DEFAULT 'EUR' CHECK (base = 'EUR'),
  rates jsonb NOT NULL CHECK (jsonb_typeof(rates) = 'object' AND rates ? 'EUR' AND rates->>'EUR' = '1'),
  fetched_at timestamptz NOT NULL,
  PRIMARY KEY (provider, rate_date, revision)
);
CREATE INDEX fx_snapshots_recent ON fx_snapshots (provider, rate_date, fetched_at DESC);
CREATE TABLE fx_resolutions (
  provider text NOT NULL,
  requested_date date NOT NULL,
  rate_date date NOT NULL,
  checked_at timestamptz NOT NULL,
  PRIMARY KEY (provider, requested_date),
  CHECK (rate_date <= requested_date AND requested_date - rate_date <= 7)
);
-- resolution 指向日期而非旧 revision；同日修订对所有请求日期立即可见。
