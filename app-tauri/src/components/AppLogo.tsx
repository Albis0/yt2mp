/// yt2mp's own mark: the "2" of the name turning into an arrow.
///
/// Drawn from branding/yt2mp-dark.svg and yt2mp-light.svg. The two files are
/// one design with the ground and the "2" swapped, so this renders both from
/// the theme's `--mark-*` colours rather than shipping two copies.
export default function AppLogo({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect
        x="0.5"
        y="0.5"
        width="99"
        height="99"
        rx="21.5"
        fill="var(--mark-ground)"
        stroke="var(--mark-edge)"
        strokeWidth="1"
      />
      <g transform="translate(-1 -2)">
        <path
          d="M32 38 A18 18 0 1 1 60.33 52.74 L30 74"
          stroke="var(--mark-ink)"
          strokeWidth="15"
          strokeLinejoin="round"
          fill="none"
        />
        <polygon
          points="24,69 66,69 66,64.5 79,76.5 66,88.5 66,84 24,84"
          fill="#FF4A1C"
          stroke="var(--mark-ground)"
          strokeWidth="3"
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      </g>
    </svg>
  );
}
