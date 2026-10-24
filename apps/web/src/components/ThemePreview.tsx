import { oceanPath } from "../lib/oceanGeometry.js";

/** Edited miniatures, not scaled interactive pages. Colours inherit the live
 * product tokens. The ocean uses its original presentation-state paths;
 * no animation or geometry changes. SVG type is decorative illustration detail.
 */
export function ThemePreview({ kind }: { readonly kind: "space" | "detail" }): React.JSX.Element {
  return kind === "space" ? <SpacePreview /> : <DetailPreview />;
}

function SpacePreview(): React.JSX.Element {
  return (
    <div role="img" aria-label="账本空间起始页预览" className="relative h-full overflow-hidden bg-canvas">
      <svg viewBox="0 0 100 110" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full">
        {[3, 2, 1, 0].map((layer) => (
          <path key={layer} fill={`var(--color-ocean-${String(layer + 1)})`} d={oceanPath(layer, 0, 0)} />
        ))}
      </svg>
      <svg viewBox="0 0 180 320" aria-hidden="true" className="absolute inset-0 size-full" fill="var(--color-on-ocean)">
        <text x="90" y="112" textAnchor="middle" fontSize="16" fontWeight="600" letterSpacing="2">Libevra</text>
        <text x="90" y="129" textAnchor="middle" fontSize="6">记一本账，安静而长久。</text>
        <path d="m86 194 4-4 4 4" fill="none" stroke="currentColor" className="text-on-ocean" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function DetailPreview(): React.JSX.Element {
  return (
    <svg role="img" aria-label="明细页面预览" viewBox="0 0 180 320" className="appearance-detail-preview size-full bg-canvas">
      <g aria-hidden="true">
        <path d="M0 0H180V138H0Z" fill="var(--preview-header)" />
        <g fill="var(--preview-header-ink)">
          <text x="12" y="24" fontSize="10" fontWeight="650">Libevra</text>
          <circle cx="147" cy="20" r="1" /><circle cx="153" cy="20" r="1" /><circle cx="159" cy="20" r="1" />
          <text x="12" y="43" fontSize="6">2026 年 10 月 ▾</text>
          <rect x="11" y="54" width="158" height="48" rx="8" fill="var(--preview-summary)" />
          <text x="19" y="67" fontSize="6">人民币 · 本月支出</text>
          <text x="19" y="85" fontSize="14" fontWeight="600">¥1,257.00</text>
          <text x="19" y="95" fontSize="5">入账 ¥18,000.00</text>
          <text x="158" y="95" fontSize="5" textAnchor="end">结余 ¥16,743.00</text>
          <rect x="11" y="108" width="76" height="22" rx="6" fill="var(--preview-summary)" />
          <text x="18" y="117" fontSize="5">美元</text>
          <text x="18" y="125" fontSize="6">$150.30</text>
          <rect x="93" y="108" width="76" height="22" rx="6" fill="var(--preview-summary)" />
          <text x="131" y="122" fontSize="6" textAnchor="middle">更多币种</text>
        </g>
        <rect x="11" y="146" width="158" height="18" rx="9" fill="var(--color-brand-soft)" />
        <rect x="12" y="147" width="78" height="16" rx="8" fill="var(--color-surface)" />
        <text x="51" y="158" textAnchor="middle" fontSize="6" fill="var(--color-ink)">支出</text>
        <text x="130" y="158" textAnchor="middle" fontSize="6" fill="var(--color-muted)">收入</text>
        <text x="12" y="183" fontSize="5.5" fill="var(--color-muted)">今天 · 10 月 24 日</text>
        <rect x="11" y="191" width="158" height="66" rx="8" fill="var(--color-surface)" />
        {[
          { y: 208, label: "餐饮 · 午餐", amount: "−¥28.00", time: "12:30 · 微信", icon: "M18 204h5v3a2.5 2.5 0 0 1-5 0Zm5 1h2v2h-2" },
          { y: 240, label: "购物 · 日常", amount: "−¥159.00", time: "10:12 · 支付宝", icon: "M18 236h6v6h-6Zm1-1a2 2 0 0 1 4 0" },
        ].map(({ y, label, amount, time, icon }) => (
          <g key={label}>
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
        {[{x:21,label:"明细"},{x:54,label:"分析"},{x:125,label:"账本"},{x:159,label:"我的"}].map(({x,label})=>(
          <text key={label} x={x} y="315" textAnchor="middle" fontSize="4.5" fill="var(--color-muted)">{label}</text>
        ))}
      </g>
    </svg>
  );
}
