import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { t } from "../shared/i18n";
import { highlightCode } from "./highlight";
import "./code-block.css";

// A fenced block of code in a reply: its language and a copy button on top,
// then the code itself, highlighted and scrolling sideways instead of
// wrapping.
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const text = code.replace(/\n$/, "");
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{language || t("Code")}</span>
        <button
          type="button"
          aria-label={copied ? t("Copied") : t("Copy code")}
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? (
            <Check size={18} aria-hidden="true" />
          ) : (
            <Copy size={18} aria-hidden="true" />
          )}
        </button>
      </div>
      <pre className="code-block-body">
        <code>
          {highlightCode(text, language).map((token, index): ReactNode =>
            token.kind ? (
              <span key={index} className={`code-${token.kind}`}>
                {token.text}
              </span>
            ) : (
              token.text
            ),
          )}
        </code>
      </pre>
    </div>
  );
}
