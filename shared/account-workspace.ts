import { z } from "zod";

const resourceId = z.string().regex(/^[\w-]{1,200}$/);
// Uploaded (custom) skills, vaults, files, and TOS buckets are reachable by
// every holder of the same Ark key and cannot be attributed to an account, so
// an account's agent, environment, and sessions may not reference them.
// Built-in and hub skills are public.
export const accountSkills = (skills: unknown) =>
  skills === undefined ||
  (Array.isArray(skills) &&
    skills.every((skill) =>
      ["ark", "skill_hub"].includes(
        (skill as { type?: unknown })?.type as string,
      ),
    ));
// Settings a user may change on the account's own agent and environment. Labels
// and ownership metadata are never accepted from a client.
export const agentChangesSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    model: z
      .object({ id: z.string().min(1).max(200) })
      .passthrough()
      .optional(),
    system: z.string().max(64000).optional(),
    tools: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
    mcp_servers: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
    skills: z
      .array(z.record(z.string(), z.unknown()))
      .max(50)
      .refine(accountSkills)
      .optional(),
  })
  .strict();
export const environmentChangesSchema = z
  .object({
    name: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    config: z
      .record(z.string(), z.unknown())
      .refine((config) => !("tos" in config))
      .optional(),
  })
  .strict();
// What Ark reports for the account's agent and environment after the last
// change made through Open Muse, sealed with the account's workspace record.
const snapshot = z.record(z.string(), z.unknown());
// An account's workspace configuration, sealed by the service per account and
// workspace key: the resources the service created for it, the agent model,
// and the agent and environment settings last applied through Open Muse.
export const accountWorkspaceSchema = z
  .object({
    environmentId: resourceId.optional(),
    memoryStoreId: resourceId.optional(),
    agentId: resourceId.optional(),
    model: z.string().min(1).max(200),
    agent: snapshot.optional(),
    environment: snapshot.optional(),
    // Settings replaced by an explicit reset to defaults, kept for the user.
    previous: z
      .object({ agent: snapshot.optional(), environment: snapshot.optional() })
      .strict()
      .optional(),
    // When the user kept the saved settings although Ark may differ from them.
    drift: z
      .object({
        agent: z.number().int().optional(),
        environment: z.number().int().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AccountWorkspace = z.infer<typeof accountWorkspaceSchema>;
export const accountWorkspaceResponseSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    workspace: accountWorkspaceSchema.optional(),
    unconfirmed: z.boolean(),
    // A settings change whose result is unconfirmed or needs the user's review.
    // "drift": the user kept the saved settings although Ark may differ.
    settings: z.enum(["unconfirmed", "review", "drift"]).optional(),
    // How a deleted agent or environment was created again.
    rebuilt: z
      .object({
        agent: z.enum(["restored", "recreated_with_defaults"]).optional(),
        environment: z.enum(["restored", "recreated_with_defaults"]).optional(),
      })
      .strict()
      .optional(),
    // How an unconfirmed change was resolved.
    change: z
      .enum([
        "applied",
        "adopted",
        "not_applied_yet",
        "discarded",
        "drift_cleared",
        "drift_kept",
        // Ark shows these values at the time of the check; an earlier
        // unconfirmed environment change may still arrive later.
        "matches_now",
      ])
      .optional(),
    // After a settings change: whether background work was rebound to the
    // new agent version (which pauses the schedule) or needs review.
    background: z.enum(["unchanged", "rebound", "stale"]).optional(),
  })
  .strict();
export type AccountWorkspaceResponse = z.infer<
  typeof accountWorkspaceResponseSchema
>;
