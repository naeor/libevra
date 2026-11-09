import { useI18n } from "../i18n/index.js";
import { Card } from "./Card.js";
import { OceanBackdrop } from "./OceanBackdrop.js";
import { formatMonthLabel } from "../lib/datetime.js";

/** 只读样例，复用正式海浪、Card 材质与主题/壁纸变量。不挂业务查询或写入动作。 */
export function ThemePreview({ kind }: { readonly kind: "space" | "detail" }): React.JSX.Element {
  const { t } = useI18n();
  return kind === "space" ? <div className="appearance-live-preview ledger-space" style={{ ["--p" as string]: 1 }} aria-label={t("settings.preview.spaceLabel")}>
    <OceanBackdrop />
    <div className="relative z-[2] flex flex-col gap-4 px-5 py-4">
      <h3 className="text-section-title text-ink">{t("books.space.heading")}</h3>
      <Card className="appearance-sample-card"><p className="text-body text-ink">{t("settings.visualStyle.previewspace")}</p><p className="mt-2 text-helper text-muted">{t("settings.preview.slogan")}</p></Card>
      <Card className="appearance-sample-card"><p className="text-body text-ink">{t("settings.preview.balance")}</p></Card>
    </div>
  </div> : <div className="appearance-live-preview appearance-detail-preview" aria-label={t("settings.preview.detailLabel")}>
    <header className="appearance-sample-header px-5 pb-4 pt-6">
      <h3 className="text-section-title">Libevra</h3>
      <p className="my-3 text-helper">{formatMonthLabel("2026-10")}</p>
      <Card className="appearance-sample-card">
        <p className="text-helper text-muted">{t("settings.preview.summary")}</p>
        <p className="my-2 text-2xl font-semibold text-ink">¥1,257.00</p>
        <p className="text-helper text-muted">{t("settings.preview.inflow")}</p>
      </Card>
    </header>
    <div className="flex flex-col gap-3 p-5">
      <p className="text-helper text-muted">{t("settings.preview.dayHeading")}</p>
      <Card className="appearance-sample-card">
        {(["lunch", "shopping"] as const).map((key, index) => <div key={key} className="flex items-center justify-between gap-3 border-b border-line py-3 last:border-0">
          <span><span className="block text-body text-ink">{t(`settings.preview.${key}`)}</span><span className="block text-helper text-muted">{t(`settings.preview.${key}Meta`)}</span></span>
          <span className="text-body text-ink">{index === 0 ? "−¥28.00" : "−¥159.00"}</span>
        </div>)}
      </Card>
    </div>
  </div>;
}
