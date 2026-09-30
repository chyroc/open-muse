import { t } from "../../shared/i18n";
import {
  backgroundConfigurationSchema,
  type BackgroundConfiguration,
} from "../../shared/background-connection";
import type { ArkClient } from "../../shared/ark";
import type { DirectAuth } from "./auth";
import type { DirectWorkspace } from "./workspace";
import type { DirectIdentity } from "./identity";

// Export only after an explicit upload action. Do not return the saved login
// object: it can contain control-plane, session, and refresh credentials.
export async function exportBackgroundConfiguration(
  confirm: boolean,
  auth: DirectAuth,
  workspace: DirectWorkspace,
  companion: DirectIdentity,
  ark: ArkClient,
): Promise<BackgroundConfiguration> {
  if (confirm !== true)
    throw new Error(
      t("Confirm uploading the current Ark configuration first."),
    );
  const login = auth.value;
  if (!login?.apiKey)
    throw new Error(t("Connect to Ark before syncing background access."));
  const apiKey = login.apiKey,
    project = login.project ?? "";
  const selection = await workspace.selection();
  const memoryStoreId = await companion.storeId();
  if (!memoryStoreId)
    throw new Error(
      t(
        "Prepare your personal memory in Settings before syncing background access.",
      ),
    );
  const agent = await ark.request<{ id: string; version: number }>(
    `/agents/${encodeURIComponent(selection.agent)}`,
  );
  if (
    auth.value !== login ||
    login.apiKey !== apiKey ||
    (login.project ?? "") !== project
  )
    throw new Error(
      t(
        "The local Ark login changed. Review the current account before syncing.",
      ),
    );
  if (agent.id !== selection.agent)
    throw new Error(t("The Ark agent response did not match this workspace."));
  const config = backgroundConfigurationSchema.safeParse({
    apiKey,
    project,
    agentId: selection.agent,
    agentVersion: agent.version,
    environmentId: selection.environment_id,
    memoryStoreId,
  });
  if (!config.success)
    throw new Error(
      t("The current Ark workspace is incomplete. Refresh it before syncing."),
    );
  return config.data;
}
