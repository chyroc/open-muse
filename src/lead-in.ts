// A reply that hands over files often opens with one short line, such as
// "Done, here it is 👇", before its summary. When the reply carries files,
// that line is shown on its own with the files right under it and the
// summary after, as a person would send them. Only a short plain line is
// taken: never a heading, list, table, quote, or code.
export function splitLeadIn(text: string) {
  const match = /^([^\n]+)\n\s*\n([\s\S]*\S[\s\S]*)$/.exec(text.trim());
  if (!match) return undefined;
  const [, lead, rest] = match;
  if ([...lead].length > 40 || /^\s*([#>|`*+-]|\d+[.)])/.test(lead))
    return undefined;
  return { lead: lead.trim(), rest: rest.trim() };
}
