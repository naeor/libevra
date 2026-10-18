/**
 * The product mark: a small stroke glyph of a ledger page with a wave along its lower edge.
 *
 * ⚠️ **Stroke, not fill.** At 16–20px a filled shape blurs into a blob; the same lesson the
 * small gear icon learned in 1.10.09. Extracted from `AuthLayout` in S14-B because the guest
 * workspace needs the same mark, and a second copy of an SVG is a second thing to drift.
 */
export function BrandMark({
  className = "size-7",
}: {
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 5.5h9.5A3.5 3.5 0 0 1 18 9v9.5H8.5A3.5 3.5 0 0 1 5 15V5.5Z" />
      <path d="M5 15a3.5 3.5 0 0 1 3.5-3.5H18" />
      <path d="M9 8.5h5" />
    </svg>
  );
}
