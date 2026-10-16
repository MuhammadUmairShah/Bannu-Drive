import { useId } from "react";
import { Link } from "react-router-dom";

/** Auto-rickshaw icon (lucide has none). Shared by the public pages. */
export const RickshawIcon = ({ className = "" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4 16V8.5L6 5h8l1.5 3.5V16" />
    <path d="M15.5 11H19l2 3v2H4" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17.5" cy="17.5" r="1.8" />
  </svg>
);

/* Road-lane animation. Scoped class names, respects reduced motion. */
const MARK_CSS = `
  .bd-dash { stroke-dasharray: 2.6 3.4; }
  .bd-dash[data-anim="always"] { animation: bd-flow 1s linear infinite; }
  .group:hover .bd-dash[data-anim="hover"] { animation: bd-flow 1s linear infinite; }
  .bd-halo[data-anim="always"] { animation: bd-pulse 2.4s ease-in-out infinite; transform-origin: 28px 12.5px; }
  @keyframes bd-flow { to { stroke-dashoffset: -6; } }
  @keyframes bd-pulse { 0%,100% { opacity: .35; transform: scale(1); } 50% { opacity: .1; transform: scale(1.5); } }
  @media (prefers-reduced-motion: reduce) {
    .bd-dash, .bd-halo { animation: none !important; }
  }
`;

/**
 * Logo mark: a location pin whose inside is a road running to the horizon,
 * with speed lines trailing behind it.
 *
 * Props
 *  - size:       pixel size (default 40)
 *  - animate:    "hover" (default, needs a parent with `group`), "always", or "none"
 *  - decorative: true when the mark sits next to the text "Bannu Drive"
 *                (hides it from screen readers so it is not read twice)
 *
 * Use <LogoMark /> alone for app icons / panels, <Logo /> for the full lockup.
 */
export function LogoMark({
  size = 40,
  className = "",
  animate = "hover",
  decorative = false,
}) {
  // useId gives every instance its own gradient ids, so two logos on one
  // page (navbar + footer) never clash. Colons are stripped for url(#id).
  const uid = useId().replace(/:/g, "");
  const id = (name) => `bd-${uid}-${name}`;

  const a11y = decorative
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": "Bannu Drive" };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      {...a11y}
    >
      <style>{MARK_CSS}</style>

      <defs>
        {/* pin body: light mint at the top-left to deep green at the tip */}
        <linearGradient
          id={id("pin")}
          x1="16"
          y1="6"
          x2="40"
          y2="41"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#6BF5BE" />
          <stop offset=".45" stopColor="#25D793" />
          <stop offset="1" stopColor="#007F52" />
        </linearGradient>

        {/* soft glow in the tile's top-right corner */}
        <radialGradient id={id("glow")} cx=".8" cy=".12" r=".85">
          <stop offset="0" stopColor="#2EE59D" stopOpacity=".26" />
          <stop offset="1" stopColor="#2EE59D" stopOpacity="0" />
        </radialGradient>

        {/* tile border fades from top to bottom */}
        <linearGradient
          id={id("rim")}
          x1="24"
          y1="0"
          x2="24"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#2EE59D" stopOpacity=".55" />
          <stop offset="1" stopColor="#2EE59D" stopOpacity=".1" />
        </linearGradient>

        {/* speed lines fade out behind the pin */}
        <linearGradient
          id={id("speed")}
          x1="2"
          y1="0"
          x2="14"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#2EE59D" stopOpacity="0" />
          <stop offset="1" stopColor="#2EE59D" stopOpacity=".85" />
        </linearGradient>
      </defs>

      {/* tile */}
      <rect width="48" height="48" rx="14" fill="#071F25" />
      <rect width="48" height="48" rx="14" fill={`url(#${id("glow")})`} />
      <rect
        x=".75"
        y=".75"
        width="46.5"
        height="46.5"
        rx="13.25"
        fill="none"
        stroke={`url(#${id("rim")})`}
        strokeWidth="1.5"
      />

      {/* speed lines */}
      <path
        d="M3 18.5h9M2 24.5h10M5 30.5h8"
        stroke={`url(#${id("speed")})`}
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* ground shadow under the pin tip */}
      <ellipse cx="28" cy="43.5" rx="6" ry="1.1" fill="#2EE59D" opacity=".22" />

      {/* pin */}
      <path
        d="M28 6.5c-7.2 0-12.5 5.3-12.5 12 0 8.6 12.5 22.5 12.5 22.5s12.5-13.9 12.5-22.5c0-6.7-5.3-12-12.5-12z"
        fill={`url(#${id("pin")})`}
      />
      {/* pin rim light + specular highlight */}
      <path
        d="M28 6.5c-7.2 0-12.5 5.3-12.5 12 0 8.6 12.5 22.5 12.5 22.5s12.5-13.9 12.5-22.5c0-6.7-5.3-12-12.5-12z"
        fill="none"
        stroke="#fff"
        strokeOpacity=".22"
        strokeWidth=".8"
      />
      <path
        d="M20.5 15c1.2-3.4 4-5.4 7.5-5.4"
        fill="none"
        stroke="#fff"
        strokeOpacity=".4"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* road inside the pin, widening toward the viewer */}
      <path d="M24.8 32 27 14.5h2L31.2 32z" fill="#071F25" />
      <path
        className="bd-dash"
        data-anim={animate}
        d="M28 16.5v13"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {/* destination dot with halo */}
      <circle
        className="bd-halo"
        data-anim={animate === "always" ? "always" : "none"}
        cx="28"
        cy="12.5"
        r="3.2"
        fill="#fff"
        opacity=".35"
      />
      <circle cx="28" cy="12.5" r="1.6" fill="#fff" />
    </svg>
  );
}

export default function Logo({
  onDark = true,
  showTagline = false,
  to = "/",
  className = "",
  size = 40,
  animate = "hover",
}) {
  return (
    <Link
      to={to}
      aria-label="Bannu Drive home"
      className={`group inline-flex items-center gap-2.5 ${className}`}
    >
      <LogoMark
        size={size}
        animate={animate}
        decorative
        className="transition duration-300 group-hover:-rotate-3 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:transform-none"
      />

      <span className="flex flex-col leading-none">
        <span
          className={`font-display text-[1.35rem] font-extrabold tracking-tight ${
            onDark ? "text-white" : "text-fg"
          }`}
        >
          Bannu<span className="text-mint">Drive</span>
        </span>

        {showTagline && (
          <span
            className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${
              onDark ? "text-white/50" : "text-muted"
            }`}
          >
            Bannu City &amp; Cantt
          </span>
        )}
      </span>
    </Link>
  );
}