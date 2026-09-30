import { z } from "zod";

const resourceId = z.string().regex(/^[\w-]{1,200}$/);
// An account's workspace configuration, sealed by the service per account and
// workspace key: the resources the service created for it and the agent model.
export const accountWorkspaceSchema = z
  .object({
    environmentId: resourceId.optional(),
    memoryStoreId: resourceId.optional(),
    agentId: resourceId.optional(),
    model: z.string().min(1).max(200),
  })
  .strict();
export type AccountWorkspace = z.infer<typeof accountWorkspaceSchema>;
export const accountWorkspaceResponseSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    workspace: accountWorkspaceSchema.optional(),
    unconfirmed: z.boolean(),
  })
  .strict();
export type AccountWorkspaceResponse = z.infer<
  typeof accountWorkspaceResponseSchema
>;
