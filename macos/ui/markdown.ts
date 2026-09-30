import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";

export function editorExtensions() {
  return [
    StarterKit.configure({
      link: { openOnClick: false, protocols: ["https", "http", "mailto"] },
    }),
    TableKit,
    Markdown,
  ];
}

// Preserve unsupported Markdown byte-for-byte in source mode. It must never be
// silently discarded by the rich-text schema when somebody saves a memory.
export function sourceOnly(content: string, name: string) {
  return (
    name === "IDENTITY.md" ||
    /!\[|^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]|<[a-z!/?]|^\s*\[[^\]]+\]:/im.test(content)
  );
}
