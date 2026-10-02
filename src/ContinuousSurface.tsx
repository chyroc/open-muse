import { useLayoutEffect, useRef, useState } from "react";
import "./continuous-surface.css";

// iOS draws large corners as continuous curves: the edge eases into the bend
// instead of meeting a circular arc at a point. CSS has no such corner, so
// floating sheets draw their surface as this path (the widely used Figma
// smoothing construction; 0.6 matches the system's continuous corners).
export function continuousRectPath(
  width: number,
  height: number,
  radius: number,
  smoothing = 0.6,
) {
  const budget = Math.min(width, height) / 2;
  const r = Math.max(0, Math.min(radius, budget));
  if (!width || !height) return "";
  if (!r) return `M0 0H${width}V${height}H0Z`;
  const s = Math.min(smoothing, budget / r - 1);
  const p = Math.min((1 + smoothing) * r, budget);
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const arc = 90 * (1 - s);
  const arcLength = Math.sin(rad(arc / 2)) * r * Math.SQRT2;
  const alpha = (90 - arc) / 2;
  const p3p4 = r * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p3p4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arcLength - c - d) / 3;
  const a = 2 * b;
  const n = (value: number) => Number(value.toFixed(3));
  const [A, B, C, D, L, R, P] = [a, b, c, d, arcLength, r, p].map(n);
  const ab = n(a + b);
  const abc = n(a + b + c);
  const bc = n(b + c);
  return [
    `M${n(width - P)} 0`,
    `c${A} 0 ${ab} 0 ${abc} ${D}`,
    `a${R} ${R} 0 0 1 ${L} ${L}`,
    `c${D} ${C} ${D} ${bc} ${D} ${abc}`,
    `L${width} ${n(height - P)}`,
    `c0 ${A} 0 ${ab} ${-D} ${abc}`,
    `a${R} ${R} 0 0 1 ${-L} ${L}`,
    `c${-C} ${D} ${-bc} ${D} ${-abc} ${D}`,
    `L${P} ${height}`,
    `c${-A} 0 ${-ab} 0 ${-abc} ${-D}`,
    `a${R} ${R} 0 0 1 ${-L} ${-L}`,
    `c${-D} ${-C} ${-D} ${-bc} ${-D} ${-abc}`,
    `L0 ${P}`,
    `c0 ${-A} 0 ${-ab} ${D} ${-abc}`,
    `a${R} ${R} 0 0 1 ${L} ${-L}`,
    `c${C} ${-D} ${bc} ${-D} ${abc} ${-D}`,
    "Z",
  ].join("");
}

// The surface behind a floating sheet's content: its fill, hairline edge and
// shadow follow the continuous corners. The sheet itself stays transparent
// and its border radius sets the corner size.
export function ContinuousSurface() {
  const svg = useRef<SVGSVGElement>(null);
  const [shape, setShape] = useState({ width: 0, height: 0, radius: 0 });
  useLayoutEffect(() => {
    const host = svg.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const radius = Number.parseFloat(
        getComputedStyle(host).borderTopLeftRadius,
      );
      setShape({
        width: host.offsetWidth,
        height: host.offsetHeight,
        radius: Number.isFinite(radius) ? radius : 0,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const d = continuousRectPath(shape.width, shape.height, shape.radius);
  return (
    <svg
      ref={svg}
      className="continuous-surface"
      width={shape.width}
      height={shape.height}
      viewBox={`0 0 ${shape.width || 1} ${shape.height || 1}`}
      aria-hidden="true"
      focusable="false"
    >
      {d && <path d={d} />}
    </svg>
  );
}
