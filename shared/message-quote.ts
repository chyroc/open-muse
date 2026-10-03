// A message can open with a quote: Markdown blockquote lines, a blank line,
// then the message itself. Replying to a message writes this format, and
// starting an idea quotes the idea's title. The agent reads the whole text;
// the chat shows the quote as a card above the message.

export function quoteMessage(quote: string, text: string) {
  const lines = quote
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`);
  return lines.length ? `${lines.join("\n")}\n\n${text}` : text;
}

export function splitQuote(message: string): { quote?: string; text: string } {
  const match = /^((?:>[^\n]*\n)+)\n+(?=[\s\S]*\S)([\s\S]*)$/.exec(message);
  if (!match) return { text: message };
  const quote = match[1]
    .split("\n")
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim();
  return quote ? { quote, text: match[2] } : { text: message };
}
