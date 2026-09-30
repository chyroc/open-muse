import { readFileSync, readdirSync } from "node:fs";

// Resolve the appearance tokens and every rule that paints its own text, so a
// legible-looking pair in one appearance cannot hide an unreadable one in the
// other. This reads the cascade as authored: the last rule that sets both a
// background and a color for a selector decides what the user sees.
export type Rule = {
  file: string;
  selector: string;
  background: string;
  color: string;
};

function declarations(body: string) {
  const out = new Map<string, string>();
  for (const line of body.split(";")) {
    const at = line.indexOf(":");
    if (at < 0) continue;
    out.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return out;
}

export function themeTokens() {
  const css = readFileSync("macos/ui/theme.css", "utf8");
  const read = (selector: string) => {
    const start = css.indexOf(selector + " {");
    const end = css.indexOf("}", start);
    return declarations(css.slice(start + selector.length + 2, end));
  };
  const light = read(":root");
  const dark = new Map([...light, ...read(`:root[data-appearance="dark"]`)]);
  return { light, dark };
}

export function paintedRules() {
  const rules: Rule[] = [];
  for (const file of readdirSync("macos/ui").filter((name) =>
    name.endsWith(".css"),
  )) {
    if (file === "theme.css") continue;
    const css = readFileSync(`macos/ui/${file}`, "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    for (const match of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const declared = declarations(match[2]);
      const background = declared.get("background") ?? "";
      const color = declared.get("color") ?? "";
      if (!background || !color) continue;
      rules.push({
        file,
        selector: match[1].trim().replace(/\s+/g, " "),
        background,
        color,
      });
    }
  }
  return rules;
}

function channels(value: string): [number, number, number, number] | undefined {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!hex) return value.trim() === "white" ? [255, 255, 255, 1] : undefined;
  const digits = hex[1];
  const expand = (text: string) =>
    text.length === 3 || text.length === 4
      ? [...text].map((one) => one + one).join("")
      : text;
  const full = expand(digits);
  const part = (at: number) => parseInt(full.slice(at, at + 2), 16);
  return [part(0), part(2), part(4), full.length === 8 ? part(6) / 255 : 1];
}

export function resolve(
  value: string,
  tokens: Map<string, string>,
  depth = 0,
): [number, number, number, number] | undefined {
  const direct = channels(value);
  if (direct) return direct;
  const reference = /var\((--[a-z0-9-]+)\)/i.exec(value);
  if (!reference || depth > 6) return undefined;
  const next = tokens.get(reference[1]);
  return next ? resolve(next, tokens, depth + 1) : undefined;
}

function over(
  top: [number, number, number, number],
  base: [number, number, number, number],
): [number, number, number, number] {
  const mix = (at: 0 | 1 | 2) => top[at] * top[3] + base[at] * (1 - top[3]);
  return [mix(0), mix(1), mix(2), 1];
}

function luminance([red, green, blue]: [number, number, number, number]) {
  const channel = (raw: number) => {
    const part = raw / 255;
    return part <= 0.03928
      ? part / 12.92
      : Math.pow((part + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

export function contrast(rule: Rule, tokens: Map<string, string>) {
  const page = resolve("var(--bg)", tokens)!;
  const background = resolve(rule.background, tokens);
  const color = resolve(rule.color, tokens);
  if (!background || !color) return undefined;
  const paint = over(background, page);
  const text = over(color, paint);
  const [light, dark] = [luminance(paint), luminance(text)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}
