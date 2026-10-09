import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Check, Copy, Download } from "lucide-react";
import { t } from "../shared/i18n";
import { highlightCode } from "./highlight";
import "./code-block.css";

// Saves a block's code as a file, where the app offers it (the Mac).
export const CodeDownload = createContext<
  ((code: string, language?: string) => void) | undefined
>(undefined);

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
  const download = useContext(CodeDownload);
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
        {download && (
          <button
            type="button"
            className="code-block-download"
            aria-label={t("Download code")}
            onClick={() => download(text, language)}
          >
            <Download size={18} aria-hidden="true" />
          </button>
        )}
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
