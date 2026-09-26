/// yt2mp's own mark: the "2" of the name turning into an arrow.
///
/// Drawn from branding/yt2mp-dark-small.svg and yt2mp-light-small.svg: the
/// cut of the mark made for small sizes, where the full-size one's arrow
/// shrinks to a bar with no head. Here it is always drawn at icon size.
/// The two files are one design with the ground and the "2" swapped, so this
/// renders both from the theme's `--mark-*` colours.
export default function AppLogo({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx="22"
        fill="var(--mark-ground)"
        stroke="var(--mark-edge)"
        strokeWidth="1"
      />
      <path
        d="M30 35 A18 18 0 1 1 58.5 50 L28 71"
        stroke="var(--mark-ink)"
        strokeWidth="16"
        strokeLinejoin="round"
        fill="none"
      />
      <polygon
        points="19,64 59,64 59,54 82,72.5 59,91 59,81 19,81"
        fill="#FF4A1C"
        stroke="var(--mark-ground)"
        strokeWidth="4.5"
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  );
}
