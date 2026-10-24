import { useI18n } from "../i18n/index.js";
import { formatMonthLabel } from "../lib/datetime.js";
import { oceanPath } from "../lib/oceanGeometry.js";

/** Edited miniatures, not scaled interactive pages. Colours inherit the live
 * product tokens. The ocean uses its original presentation-state paths;
 * no animation or geometry changes. SVG type is decorative illustration detail.
 *
 * S16 国际化：预览里的示意文字跟随界面语言（预览展示的就是“这个语言下的页面”）。金额与币种符号是示意数据，
 * 不随语言变化。
 */
export function ThemePreview({ kind }: { readonly kind: "space" | "detail" }): React.JSX.Element {
  return kind === "space" ? <SpacePreview /> : <DetailPreview />;
}

function SpacePreview(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div role="img" aria-label={t("settings.preview.spaceLabel")} className="relative h-full overflow-hidden bg-canvas">
      <svg viewBox="0 0 100 110" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full">
        {[3, 2, 1, 0].map((layer) => (
          <path key={layer} fill={`var(--color-ocean-${String(layer + 1)})`} d={oceanPath(layer, 0, 0)} />
        ))}
      </svg>
      <svg viewBox="0 0 180 320" aria-hidden="true" className="absolute inset-0 size-full" fill="var(--color-on-ocean)">
        <text x="90" y="112" textAnchor="middle" fontSize="16" fontWeight="600" letterSpacing="2">Libevra</text>
        <text x="90" y="129" textAnchor="middle" fontSize="6">{t("settings.preview.slogan")}</text>
        <path d="m86 194 4-4 4 4" fill="none" stroke="currentColor" className="text-on-ocean" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function DetailPreview(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <svg role="img" aria-label={t("settings.preview.detailLabel")} viewBox="0 0 180 320" className="appearance-detail-preview size-full bg-canvas">
      <g aria-hidden="true">
        <path d="M0 0H180V138H0Z" fill="var(--preview-header)" />
        <g fill="var(--preview-header-ink)">
          <text x="12" y="24" fontSize="10" fontWeight="650">Libevra</text>
          <circle cx="147" cy="20" r="1" /><circle cx="153" cy="20" r="1" /><circle cx="159" cy="20" r="1" />
          <text x="12" y="43" fontSize="6">{`${formatMonthLabel("2026-10")} ▾`}</text>
          <rect x="11" y="54" width="158" height="48" rx="8" fill="var(--preview-summary)" />
          <text x="19" y="67" fontSize="6">{t("settings.preview.summary")}</text>
          <text x="19" y="85" fontSize="14" fontWeight="600">¥1,257.00</text>
          <text x="19" y="95" fontSize="5">{t("settings.preview.inflow")}</text>
          <text x="158" y="95" fontSize="5" textAnchor="end">{t("settings.preview.balance")}</text>
          <rect x="11" y="108" width="76" height="22" rx="6" fill="var(--preview-summary)" />
          <text x="18" y="117" fontSize="5">{t("settings.preview.secondCurrency")}</text>
          <text x="18" y="125" fontSize="6">$150.30</text>
          <rect x="93" y="108" width="76" height="22" rx="6" fill="var(--preview-summary)" />
          <text x="131" y="122" fontSize="6" textAnchor="middle">{t("settings.preview.moreCurrencies")}</text>
        </g>
        <rect x="11" y="146" width="158" height="18" rx="9" fill="var(--color-brand-soft)" />
        <rect x="12" y="147" width="78" height="16" rx="8" fill="var(--color-surface)" />
        <text x="51" y="158" textAnchor="middle" fontSize="6" fill="var(--color-ink)">{t("settings.preview.expense")}</text>
        <text x="130" y="158" textAnchor="middle" fontSize="6" fill="var(--color-muted)">{t("settings.preview.income")}</text>
        <text x="12" y="183" fontSize="5.5" fill="var(--color-muted)">{t("settings.preview.dayHeading")}</text>
        <rect x="11" y="191" width="158" height="66" rx="8" fill="var(--color-surface)" />
        {[
          { y: 208, label: t("settings.preview.lunch"), amount: "−¥28.00", time: t("settings.preview.lunchMeta"), icon: "M18 204h5v3a2.5 2.5 0 0 1-5 0Zm5 1h2v2h-2" },
          { y: 240, label: t("settings.preview.shopping"), amount: "−¥159.00", time: t("settings.preview.shoppingMeta"), icon: "M18 236h6v6h-6Zm1-1a2 2 0 0 1 4 0" },
        ].map(({ y, label, amount, time, icon }) => (
          <g key={y}>
            <circle cx="21" cy={y - 1} r="8" fill="var(--color-brand-soft)" />
            <path d={icon} fill="none" stroke="var(--color-category-ink)" strokeWidth="0.8" strokeLinejoin="round" />
            <text x="35" y={y - 1} fontSize="6.5" fill="var(--color-ink)">{label}</text>
            <text x="35" y={y + 9} fontSize="5" fill="var(--color-muted)">{time}</text>
            <text x="160" y={y} textAnchor="end" fontSize="6.5" fill="var(--color-ink)">{amount}</text>
          </g>
        ))}
        <path d="M0 291H180V320H0Z" fill="var(--color-surface)" />
        <path d="M0 291H180" stroke="var(--color-line)" strokeWidth="0.5" />
        <g transform="translate(0 149)" fill="none" stroke="var(--color-muted)" strokeWidth="1" strokeLinecap="round">
          <path d="M50 157v-4m4 4v-7m4 7v-5M122 157v-2a3 3 0 0 1 6 0v2" />
          <circle cx="125" cy="150" r="2" /><circle cx="159" cy="151" r="2" />
          <path d="M156 158a3 3 0 0 1 6 0" />
        </g>
        <path d="M17 300h8m-8 3h8m-8 3h5" stroke="var(--color-brand-dark)" strokeWidth="1" strokeLinecap="round" />
        <circle cx="90" cy="295" r="13" fill="var(--color-brand)" />
        <path d="M85 295h10m-5-5v10" stroke="var(--color-on-brand)" strokeWidth="1.2" strokeLinecap="round" />
        {[{x:21,label:t("settings.preview.tabs.entries")},{x:54,label:t("settings.preview.tabs.insights")},{x:125,label:t("settings.preview.tabs.ledger")},{x:159,label:t("settings.preview.tabs.me")}].map(({x,label})=>(
          <text key={x} x={x} y="315" textAnchor="middle" fontSize="4.5" fill="var(--color-muted)">{label}</text>
        ))}
      </g>
    </svg>
  );
}
