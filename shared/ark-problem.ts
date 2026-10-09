import { t } from "./i18n";

// Why the model service refused or failed a request, in terms a person can
// act on. Read from the HTTP status, the backend's error code, and its
// message; the message is matched here only and never shown.
export const arkProblems = [
  "invalid_key",
  "model_unavailable",
  "account_overdue",
  "access_denied",
  "rate_limited",
  "not_found",
  "rejected",
  "unavailable",
] as const;
export type ArkProblem = (typeof arkProblems)[number];

export const isArkProblem = (value: unknown): value is ArkProblem =>
  arkProblems.includes(value as ArkProblem);

// A model or endpoint ID named in a refusal, when it looks like one.
const modelId = /^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/;
export function refusedModel(message = "") {
  // Ark names a model either by its ID or as "name@version"; the console
  // lists it as "name-version".
  const named = message
    .match(
      /(?:endpoint|model)(?:\.id)?:? ?"?([A-Za-z0-9][A-Za-z0-9._@-]{2,80})"? (?:is invalid|does not exist|is not|not )/i,
    )?.[1]
    ?.replace("@", "-");
  return named && modelId.test(named) ? named : undefined;
}

export function arkProblem(
  status: number,
  code = "",
  message = "",
): ArkProblem {
  const text = `${code} ${message}`;
  if (
    status === 401 ||
    /^(Authentication|InvalidApiKey|InvalidAPIKey|Unauthorized|invalid_api_key|authentication_error)/i.test(
      code,
    )
  )
    return "invalid_key";
  if (
    /ModelNotOpen|ModelNotActivated|InvalidEndpointOrModel|EndpointNotFound|model or endpoint does not exist|do not have access to (?:it|the model)|model[^.]{0,40}not (?:been )?(?:open|activated|enabled)|未开通/i.test(
      text,
    )
  )
    return "model_unavailable";
  if (/overdue|arrear|insufficient[ _]?balance|欠费|余额不足/i.test(text))
    return "account_overdue";
  if (
    status === 429 ||
    /RateLimit|TooManyRequests|QuotaExceeded|ServerOverloaded|rate_limit|overloaded/i.test(
      code,
    )
  )
    return "rate_limited";
  if (
    status === 403 ||
    /^(AccessDenied|Forbidden|Permission|ServiceNotOpen|OperationDenied|permission_error)/i.test(
      code,
    )
  )
    return "access_denied";
  if (status === 404) return "not_found";
  if (status >= 400 && status < 500) return "rejected";
  return "unavailable";
}

// What the person can do about it. `service` names the backend ("Ark" or
// "Claude"); the console steps exist only for Ark.
export function arkProblemText(
  problem: ArkProblem,
  options: { service?: string; model?: string } = {},
) {
  const service =
    !options.service || options.service === "Ark" ? t("Ark") : options.service;
  const ark = service === t("Ark");
  switch (problem) {
    case "invalid_key":
      return t(
        "{service} rejected this API key. Check it, or use a different key.",
        { service },
      );
    case "model_unavailable":
      if (!ark)
        return t(
          "{service} cannot use the model this needs with this API key.",
          { service },
        );
      return options.model && modelId.test(options.model)
        ? t(
            "Your Ark account cannot use the model {model} yet. Enable it under Model activation in the Ark console, then try again.",
            { model: options.model },
          )
        : t(
            "Your Ark account cannot use the model this needs yet. Enable it under Model activation in the Ark console, then try again.",
          );
    case "account_overdue":
      return ark
        ? t(
            "Your Volcengine account is overdue or out of balance. Top it up, then try again.",
          )
        : t(
            "Your {service} account is out of credit. Add credit, then try again.",
            { service },
          );
    case "access_denied":
      return ark
        ? t(
            "This API key is not allowed to do this. Check the key's project and permissions in the Ark console.",
          )
        : t("This API key is not allowed to do this.");
    case "rate_limited":
      return t(
        "{service} is receiving too many requests right now. Try again in a moment.",
        { service },
      );
    case "not_found":
      return t("The {service} resource this needs no longer exists.", {
        service,
      });
    case "rejected":
      return t("{service} did not accept this request.", { service });
    case "unavailable":
      return t("{service} is temporarily unavailable. Try again later.", {
        service,
      });
  }
}
