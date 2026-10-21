import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { t } from "../../shared/i18n";
import {
  modelCatalog,
  modelOption,
  type ModelChoice,
} from "../../shared/models";
import { DEFAULT_MODEL } from "../../shared/workspace-spec";
import type { Client } from "../../src/api";
import { effortLabels } from "../../src/ModelSheet";

type ModelClient = Pick<Client, "modelChoice" | "setModelChoice">;

const defaultChoice = (): ModelChoice => ({
  model: DEFAULT_MODEL,
  effort: modelOption(DEFAULT_MODEL)!.defaultEffort,
});

// The account's choice, kept in step with the phone apps through account
// sync; read again whenever the window regains focus.
function useModelChoice(client: ModelClient) {
  const [choice, setChoice] = useState<ModelChoice>();
  useEffect(() => {
    const read = () =>
      void client.modelChoice().then(
        (value) => setChoice(value ?? defaultChoice()),
        () => {},
      );
    read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [client]);
  return [choice, setChoice] as const;
}

export const modelSummary = (choice: ModelChoice) =>
  `${modelOption(choice.model)?.name ?? choice.model} · ${t(effortLabels[choice.effort])}`;

// General's Model row: the current choice, opening the Model page.
export function ModelRow({
  client,
  onOpen,
}: {
  client: ModelClient;
  onOpen: () => void;
}) {
  const [choice] = useModelChoice(client);
  return (
    <button className="settings-row settings-nav-row" onClick={onOpen}>
      <span>{t("Model")}</span>
      {choice && (
        <span className="settings-nav-value">{modelSummary(choice)}</span>
      )}
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}

// The model the companion uses for new conversations and how deeply it
// thinks, chosen per account as in the phone apps.
export function ModelSettings({ client }: { client: ModelClient }) {
  const [choice, setChoice] = useModelChoice(client);
  const [error, setError] = useState("");
  if (!choice) return null;
  const save = (next: ModelChoice) => {
    setError("");
    setChoice(next);
    void client.setModelChoice(next).catch((reason: Error) => {
      setChoice(choice);
      setError(reason.message);
    });
  };
  const option = modelOption(choice.model) ?? modelOption(DEFAULT_MODEL)!;
  return (
    <>
      <p className="settings-intro">
        {t(
          "Lighter thinking and faster models answer sooner. New conversations use your choice at once; the main chat moves to a new chapter the next time you open it, and its history is kept.",
        )}
      </p>
      <div className="settings-group" role="radiogroup" aria-label={t("Model")}>
        {modelCatalog.map((model) => (
          <label className="settings-row settings-radio-row" key={model.id}>
            <div>
              <strong>{model.name}</strong>
              <p>{model.vision ? t("Reads images") : t("Text only")}</p>
            </div>
            <input
              type="radio"
              name="open-muse-model"
              value={model.id}
              className="settings-radio"
              checked={choice.model === model.id}
              onChange={() =>
                save({ model: model.id, effort: model.defaultEffort })
              }
            />
          </label>
        ))}
      </div>
      <h2>{t("Thinking depth")}</h2>
      <div
        className="settings-group"
        role="radiogroup"
        aria-label={t("Thinking depth")}
      >
        {option.efforts.map((effort) => (
          <label className="settings-row settings-radio-row" key={effort}>
            <span>{t(effortLabels[effort])}</span>
            <input
              type="radio"
              name="open-muse-effort"
              value={effort}
              className="settings-radio"
              checked={choice.effort === effort}
              onChange={() => save({ model: choice.model, effort })}
            />
          </label>
        ))}
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <p className="settings-footnote">
        {t("Feed and Ideas keep the default model.")}
      </p>
    </>
  );
}
