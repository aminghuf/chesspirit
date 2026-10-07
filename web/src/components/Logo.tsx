// Chesspirit wordmark + glyph. The glyph is a fractured chess piece wearing a
// tilted red fedora, sitting inside a rounded square. Colours are fixed (white
// piece on the navy brand tile) in both themes, since the breaks in the piece
// are drawn in the tile colour.
//
// Usage:
//   <LogoMark size={32} />
//   <LogoLockup size={32} />   // mark + wordmark side by side
import { cn } from '../lib/utils';

interface MarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 28, className }: MarkProps) {
  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      role="img"
      aria-label="Chesspirit"
      className={cn('shrink-0', className)}
    >
      {/* Container square */}
      <rect width="240" height="240" rx="52" fill="#1f2330" />
      <g transform="translate(50 16) scale(0.7)">
        {/* Piece */}
        <g fill="#ffffff">
          <path d="M70 62 H130 L118 112 H82 Z" />
          <path d="M65 81 L69.5 78 L77 105 L70.5 96 Z" />
          <rect x="72" y="114" width="56" height="8" rx="4" />
          <rect x="63" y="127" width="74" height="13" rx="6.5" />
          <path d="M81 143 H119 C120 175 126 210 132 236 H68 C74 210 80 175 81 143 Z" />
          <path d="M64 239.5 H136 C140 251 153 256 155 270 H45 C47 256 60 251 64 239.5 Z" />
          <rect x="42" y="276" width="116" height="12" rx="6" />
        </g>
        {/* Shaded right half */}
        <g fill="#d3d7de">
          <path d="M100 62 H130 L118 112 H100 Z" />
          <path d="M100 114 H124 A4 4 0 0 1 124 122 H100 Z" />
          <path d="M100 127 H130.5 A6.5 6.5 0 0 1 130.5 140 H100 Z" />
          <path d="M100 143 H119 C120 175 126 210 132 236 H100 Z" />
          <path d="M100 239.5 H136 C140 251 153 256 155 270 H100 Z" />
          <path d="M100 276 H152 A6 6 0 0 1 152 288 H100 Z" />
          <path d="M139 169 L142.5 185 L128 192 Z" />
        </g>
        {/* Breaks, in the tile colour */}
        <g fill="#1f2330">
          <path d="M144 146 L92 171.5 L51 217 L103 191.5 Z" />
          <path d="M129 193 L103.7 229.8 L100.9 227.8 L126.2 191 Z" />
          <path d="M47.5 260.4 L125.8 235.1 L124.8 231.7 L46.5 257 Z" />
          <path d="M61.7 271.8 L139.7 239.6 L138.3 236.4 L60.3 268.6 Z" />
          <path d="M119 290.3 L151.2 278.7 L150 275.3 L117.8 287 Z" />
        </g>
        <path d="M139 150 L94 176.5 L56 213 L101 186.5 Z" fill="#ffffff" />
        <path d="M139 150 L100 173 L100 187.1 L101 186.5 Z" fill="#d3d7de" />
        {/* Fedora */}
        <g transform="rotate(13 100 63)">
          <path d="M63 61 C62 44 70 24 84 19 C92 16 97 22 104 24 C110 26 116 19 124 22 C134 27 138 46 137 61 Z" fill="#dc2f30" />
          <path d="M112 22.5 C116 20 120 20 124 22 C134 27 138 46 137 61 L118 61 C120 48 118 34 112 22.5 Z" fill="#c32a2c" />
          <path d="M62.6 50 C80 55 120 55 137.4 50 L137 62 C120 67 80 67 63 62 Z" fill="#8e1b24" />
          <path d="M35 63 C35 55 64 58 100 58 C136 58 165 55 165 63 C165 72 136 75 100 75 C64 75 35 72 35 63 Z" fill="#dc2f30" />
        </g>
      </g>
    </svg>
  );
}

interface LockupProps extends MarkProps {
  /** Render only the wordmark text class, no <svg>. Useful for inline contexts. */
  wordmarkOnly?: boolean;
}

export function LogoLockup({ size = 28, className, wordmarkOnly }: LockupProps) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      {!wordmarkOnly && <LogoMark size={size} />}
      <span
        className="font-semibold tracking-tight text-ink-900 dark:text-cream"
        style={{ fontSize: Math.round(size * 0.62) }}
      >
        Chesspirit
      </span>
    </span>
  );
}
