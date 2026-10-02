import type { ReactNode, SVGProps } from "react";

// Tab bar glyphs drawn on a 24pt grid with rounded 2pt strokes, matching the
// weight of the system tab bar symbols.
type IconProps = { size?: number; strokeWidth?: number } & Omit<
  SVGProps<SVGSVGElement>,
  "children"
>;

function Glyph({
  size = 24,
  strokeWidth = 2,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ChatGlyph(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12.4 3.4c-5.2 0-9.4 3.4-9.4 7.7 0 2.1 1 4 2.7 5.4.2 1.4-.3 2.8-1.4 3.9 1.9.2 3.8-.4 5-1.5.9.2 2 .4 3.1.4 5.2 0 9.4-3.5 9.4-7.9S17.6 3.4 12.4 3.4Z" />
    </Glyph>
  );
}

export function FeedGlyph(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="7.5" y="3" width="13.5" height="18" rx="3" />
      <path d="M7.5 7.5H6A2.5 2.5 0 0 0 3.5 10v8.5A2.5 2.5 0 0 0 6 21h4" />
      <path d="M11.5 8h5.5M11.5 12h2.8" />
    </Glyph>
  );
}

export function IdeasGlyph(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M9 16.2c0-1.1-.5-2.1-1.3-2.9A6.4 6.4 0 0 1 12 2.6a6.4 6.4 0 0 1 4.3 10.7c-.8.8-1.3 1.8-1.3 2.9" />
      <path d="M9 16.6h6v1.6a1.4 1.4 0 0 1-1.4 1.4h-3.2A1.4 1.4 0 0 1 9 18.2Z" />
      <path d="M10.8 21.4h2.4" />
    </Glyph>
  );
}

export function GoalsGlyph(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4.4" />
      <path d="m8.2 12.4 2.7 3.1 5-6.6" />
    </Glyph>
  );
}

export function LibraryGlyph(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M5.9 3.3a1.6 1.6 0 0 1 2.2 0l2.6 2.6a1.6 1.6 0 0 1 0 2.2l-2.6 2.6a1.6 1.6 0 0 1-2.2 0L3.3 8.1a1.6 1.6 0 0 1 0-2.2Z" />
      <path d="M16.1 3.8a1 1 0 0 1 1.8 0l2.9 5a1 1 0 0 1-.9 1.5h-5.8a1 1 0 0 1-.9-1.5Z" />
      <circle cx="7" cy="17" r="3.6" />
      <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.8" />
    </Glyph>
  );
}
