import { z } from "zod";

// The Ark API key is only a model-service credential. It never identifies the
// Muse user; the verified account subject owns every stored copy.
export const arkApiKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(1024)
  .regex(/^[\x21-\x7e]+$/)
  .refine((key) => !/^(cfat_|muse_device_|sb_)/.test(key));
export const arkProjectSchema = z
  .string()
  .trim()
  .max(128)
  .regex(/^[^\r\n]*$/);
export const accountCredentialSchema = z
  .object({ apiKey: arkApiKeySchema, project: arkProjectSchema })
  .strict();
export type AccountCredential = z.infer<typeof accountCredentialSchema>;
export interface AccountCredentialStatus {
  configured: boolean;
  revision: number;
  updatedAt: number | null;
}
export const accountCredentialResponseSchema = z
  .object({
    configured: z.boolean(),
    revision: z.number().int().nonnegative(),
    updatedAt: z.number().int().nullable(),
    credential: accountCredentialSchema.optional(),
  })
  .strict()
  .refine((value) => value.configured === Boolean(value.credential));
export type AccountCredentialResponse = z.infer<
  typeof accountCredentialResponseSchema
>;
