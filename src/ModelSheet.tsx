import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { t } from "../shared/i18n";
import {
  modelCatalog,
  modelOption,
  type Effort,
  type ModelChoice,
} from "../shared/models";
import { DEFAULT_MODEL } from "../shared/workspace-spec";
import type { Client } from "./api";
import { Sheet } from "./MusePages";

export const effortLabels: Record<Effort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
};

// The model the companion uses and how deeply it thinks, chosen per account.
// Faster models and lighter thinking answer sooner; only some models read
// images.
export function ModelSheet({
  client,
  onClose,
  onChanged,
}: {
  client: Pick<Client, "modelChoice" | "setModelChoice">;
  onClose: () => void;
  onChanged: (choice: ModelChoice) => void;
}) {
  const [choice, setChoice] = useState<ModelChoice>();
  const [error, setError] = useState("");
  useEffect(() => {
    void client.modelChoice().then(setChoice, () => {});
  }, [client]);
  const current: ModelChoice = choice ?? {
    model: DEFAULT_MODEL,
    effort: modelOption(DEFAULT_MODEL)!.defaultEffort,
  };
  const save = (next: ModelChoice) => {
    setError("");
    void client.setModelChoice(next).then(
      () => {
        setChoice(next);
        onChanged(next);
      },
      (reason: Error) => setError(reason.message),
    );
  };
  const option = modelOption(current.model)!;
  return (
    <Sheet title={t("Model")} onClose={onClose} grouped>
      <ul className="settings-list" role="radiogroup" aria-label={t("Model")}>
        {modelCatalog.map((model) => (
          <li key={model.id}>
            <button
              className="settings-list-row"
              role="radio"
              aria-checked={current.model === model.id}
              onClick={() =>
                current.model !== model.id &&
                save({ model: model.id, effort: model.defaultEffort })
              }
            >
              <span className="settings-row-text">
                {model.name}
                <small>
                  {model.vision ? t("Reads images") : t("Text only")}
                </small>
              </span>
              {current.model === model.id && (
                <Check size={18} className="settings-check" />
              )}
            </button>
          </li>
        ))}
      </ul>
      <h3 className="settings-group-title">{t("Thinking depth")}</h3>
      <ul
        className="settings-list"
        role="radiogroup"
        aria-label={t("Thinking depth")}
      >
        {option.efforts.map((effort) => (
          <li key={effort}>
            <button
              className="settings-list-row"
              role="radio"
              aria-checked={current.effort === effort}
              onClick={() =>
                current.effort !== effort &&
                save({ model: current.model, effort })
              }
            >
              <span className="settings-row-text">
                {t(effortLabels[effort])}
              </span>
              {current.effort === effort && (
                <Check size={18} className="settings-check" />
              )}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="settings-footnote">
        {t(
          "Lighter thinking and faster models answer sooner. New conversations use your choice at once; the main chat moves to a new chapter the next time you open it, and its history is kept.",
        )}
      </p>
    </Sheet>
  );
}
