import { useState } from "react";
import { ChevronDown, Globe, LoaderCircle, Sparkles } from "lucide-react";
import { t } from "../shared/i18n";
import { eventText } from "../shared/types";
import type { WorkCard as Work } from "../shared/work-steps";
import { Markdown } from "./components";
import "./work-card.css";

// One card for the steps of a task: what is used (the browser, or tools in
// general), whether it is still going, and the latest step. Tapping it
// shows every step.
export function WorkCard({ work }: { work: Work }) {
  const [open, setOpen] = useState(false);
  const latest = work.steps.at(-1);
  const Icon = work.browser ? Globe : Sparkles;
  return (
    <section className={`work-card${work.running ? " running" : ""}`}>
      <button
        type="button"
        className="work-card-head"
        aria-expanded={open}
        disabled={!work.steps.length}
        onClick={() => setOpen(!open)}
      >
        <span className="work-card-icon" aria-hidden="true">
          <Icon size={20} strokeWidth={2} />
        </span>
        <span className="work-card-title">
          <strong>{work.browser ? t("Browser") : t("Working on it")}</strong>
          <small>
            {work.running ? (
              <LoaderCircle size={12} className="spin" aria-hidden="true" />
            ) : null}
            {work.running ? t("In progress") : t("Done")}
            {" · "}
            {t(work.tools === 1 ? "{count} step" : "{count} steps", {
              count: work.tools,
            })}
          </small>
        </span>
        {work.steps.length > 0 && (
          <ChevronDown
            size={18}
            className="work-card-chevron"
            aria-hidden="true"
          />
        )}
      </button>
      {!open && latest && (
        <p className="work-card-latest">{eventText(latest).trim()}</p>
      )}
      {open && (
        <ol className="work-card-steps">
          {work.steps.map((step) => (
            <li key={step.id}>
              <Markdown text={eventText(step)} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
