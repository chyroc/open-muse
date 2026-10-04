// A small highlighter for code in replies: comments, strings, numbers,
// keywords, and called names, which is what makes code readable at a
// glance. It only splits text into typed pieces; nothing is ever run or
// inserted as markup.
export type CodeToken = {
  text: string;
  kind?: "comment" | "string" | "number" | "keyword" | "call";
};

const hashComments = new Set([
  "python",
  "py",
  "sh",
  "bash",
  "shell",
  "zsh",
  "ruby",
  "rb",
  "yaml",
  "yml",
  "toml",
  "r",
  "perl",
  "dockerfile",
  "makefile",
]);
const keywords = new Set(
  `and as async await break case catch class const continue def default del do elif else enum except export extends false finally fn for from func function go guard if impl implements import in interface is lambda let match mut new nil none not null or package pass private protected pub public raise return self static struct super switch then this throw throws true try type typeof undefined use var void where while with yield fi done esac echo local`.split(
    " ",
  ),
);

export function highlightCode(code: string, language = ""): CodeToken[] {
  const lang = language.toLowerCase();
  const hash = hashComments.has(lang);
  const slash = !hash;
  const pattern = new RegExp(
    [
      `(${[
        slash && "\\/\\/[^\\n]*",
        "\\/\\*[\\s\\S]*?\\*\\/",
        hash && "#[^\\n]*",
      ]
        .filter(Boolean)
        .join("|")})`,
      `("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)`,
      `(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)`,
      `([A-Za-z_$][\\w$]*)`,
    ].join("|"),
    "g",
  );
  const tokens: CodeToken[] = [];
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index!;
    if (index > last) tokens.push({ text: code.slice(last, index) });
    const [text, comment, string, number, word] = match;
    if (comment) tokens.push({ text, kind: "comment" });
    else if (string) tokens.push({ text, kind: "string" });
    else if (number) tokens.push({ text, kind: "number" });
    else if (word && keywords.has(word.toLowerCase()))
      tokens.push({ text, kind: "keyword" });
    else if (word && code[index + text.length] === "(")
      tokens.push({ text, kind: "call" });
    else tokens.push({ text });
    last = index + text.length;
  }
  if (last < code.length) tokens.push({ text: code.slice(last) });
  return tokens;
}
