import { z } from "zod";

const resourceId = z.string().regex(/^[\w-]{1,200}$/);
export const backgroundConfigurationSchema = z
  .object({
    apiKey: z
      .string()
      .min(16)
      .max(1024)
      .regex(/^[\x21-\x7e]+$/)
      .refine((key) => !/^(cfat_|muse_device_)/.test(key)),
    project: z
      .string()
      .max(128)
      .regex(/^[^\r\n]*$/),
    agentId: resourceId,
    agentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    environmentId: resourceId,
    memoryStoreId: resourceId,
  })
  .strict();

// Deliberate opt-in export only. Never include SSO/refresh credentials, vaults,
// personal documents, arbitrary upstream URLs, or tool permission policies.
export type BackgroundConfiguration = z.infer<
  typeof backgroundConfigurationSchema
>;
// Account workspaces send only resource IDs. The Worker pairs them with the
// Ark key already stored for the same verified account.
export const backgroundWorkspaceSchema = backgroundConfigurationSchema
  .pick({
    agentId: true,
    agentVersion: true,
    environmentId: true,
    memoryStoreId: true,
  })
  .strict();
export type BackgroundWorkspace = z.infer<typeof backgroundWorkspaceSchema>;
export interface BackgroundConnectionStatus {
  configured: boolean;
  revision: number;
  updatedAt: number | null;
}
