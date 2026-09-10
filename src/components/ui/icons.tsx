/**
 * The few drawn icons.
 *
 * Inline SVG, where the rest of this interface uses Unicode glyphs — `＋`, `⤓`,
 * `☰`. That is a deliberate exception and worth naming rather than leaving as
 * an inconsistency somebody trips over: there is no Unicode character for
 * "reset filter" or "share" that renders the same way on Windows, macOS and
 * Linux, and a menu whose items are missing-glyph boxes on one platform is
 * worse than a mixed vocabulary. The magnifier is here for the same reason —
 * `⌕` is missing from several common Windows fonts.
 *
 * They take the surrounding text's colour, so they work in both schemes
 * without a second definition, and every one of them is drawn behind a real
 * word and hidden from assistive technology by its caller.
 */

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SearchIcon() {
  return (
    <Svg>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Svg>
  );
}

export function ChevronIcon() {
  return (
    <Svg>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function FunnelIcon() {
  return (
    <Svg>
      <path d="M3 5h18l-7 8v6l-4 2v-8Z" />
    </Svg>
  );
}

export function ResetIcon() {
  return (
    <Svg>
      <path d="M4 12a8 8 0 1 1 2.3 5.7" />
      <path d="M4 5v5h5" />
    </Svg>
  );
}

export function ShareIcon() {
  return (
    <Svg>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4" />
    </Svg>
  );
}

export function SaveIcon() {
  return (
    <Svg>
      <path d="M4 4h12l4 4v12H4Z" />
      <path d="M8 4v5h7M8 20v-6h8v6" />
    </Svg>
  );
}

/**
 * Remove a row. Here rather than `🗑` for the reason at the top of this file,
 * and one it demonstrates especially well: the emoji is drawn in colour on
 * some platforms, monochrome on others, and is missing entirely from several
 * Windows fonts — three renderings of one control.
 */
export function TrashIcon() {
  return (
    <Svg>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Svg>
  );
}
