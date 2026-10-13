import { cleanFailure, type FailedRequest } from "../../shared/diagnostic-log";
import { HttpError, type Env } from "./env";

// Redacted records of what went wrong for one account, so a problem can be
// looked into without asking the person to reproduce it: failures the
// service answered itself, and reports the person chose to send from the
// app. Every field passes the same narrow checks as the app's own record, so
// no message text, key, account or resource ID, or anything a person wrote is
// kept. Records last 14 days, at most 200 per account.
const RETENTION = 14 * 86_400_000;
const PER_ACCOUNT = 200;
const REPORTS_PER_HOUR = 10;
const platforms = ["mac", "windows", "ios", "android"] as const;

export type DiagnosticReport = {
  platform: (typeof platforms)[number];
  app_version: string;
  system: string;
  failures: FailedRequest[];
};

// What the app sends when the person agrees to report a problem. Anything
// beyond these fields, or failing their patterns, is refused or dropped.
export function diagnosticReportInput(
  input: Record<string, unknown>,
): DiagnosticReport {
  if (
    !platforms.includes(input.platform as DiagnosticReport["platform"]) ||
    typeof input.app_version !== "string" ||
    !/^[0-9A-Za-z.+() -]{1,60}$/.test(input.app_version) ||
    typeof input.system !== "string" ||
    !/^[\w.,;:/() -]{0,160}$/.test(input.system) ||
    !Array.isArray(input.failures) ||
    input.failures.length > 20 ||
    Object.keys(input).some(
      (key) => !["platform", "app_version", "system", "failures"].includes(key),
    )
  )
    throw new HttpError(400, "Describe the problem report with its details.");
  return {
    platform: input.platform as DiagnosticReport["platform"],
    app_version: input.app_version,
    system: input.system,
    failures: input.failures.flatMap(
      (entry) => cleanFailure(entry as Partial<FailedRequest>) ?? [],
    ),
  };
}

export class AccountDiagnostics {
  constructor(
    private env: Env,
    private owner: string,
  ) {}

  private async insert(kind: "service" | "report", body: object, now: number) {
    const id = crypto.randomUUID();
    await this.env.DB.batch([
      this.env.DB.prepare(
        "INSERT INTO account_diagnostics(owner_id,id,kind,created_at,body) VALUES (?,?,?,?,?)",
      ).bind(this.owner, id, kind, now, JSON.stringify(body)),
      // Old records go for every account; this account keeps its newest.
      this.env.DB.prepare(
        "DELETE FROM account_diagnostics WHERE created_at<?",
      ).bind(now - RETENTION),
      this.env.DB.prepare(
        `DELETE FROM account_diagnostics WHERE owner_id=? AND id NOT IN (
          SELECT id FROM account_diagnostics WHERE owner_id=? ORDER BY created_at DESC, id LIMIT ?)`,
      ).bind(this.owner, this.owner, PER_ACCOUNT),
    ]);
    return id;
  }

  // A failure the service answered for this account. Never throws: losing
  // the record must not change the answer.
  async failed(entry: Omit<FailedRequest, "at">, now = Date.now()) {
    const kept = cleanFailure({ ...entry, at: now });
    if (!kept) return;
    await this.insert("service", kept, now).catch(() => undefined);
  }

  async report(input: DiagnosticReport, now = Date.now()) {
    const recent = await this.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM account_diagnostics WHERE owner_id=? AND kind='report' AND created_at>?",
    )
      .bind(this.owner, now - 3_600_000)
      .first<{ n: number }>();
    if (Number(recent?.n ?? 0) >= REPORTS_PER_HOUR)
      throw new HttpError(
        429,
        "Too many problem reports for this account. Try again in an hour.",
        "report_limit",
      );
    return { id: await this.insert("report", input, now) };
  }
}
