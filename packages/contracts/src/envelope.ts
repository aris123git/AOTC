import { z } from "zod";

export const EnvironmentSchema = z.enum(["sandbox", "production"]);

export const ActorRoleSchema = z.enum([
  "investor",
  "sgi_agent",
  "aotc_admin",
  "super_admin",
  "system",
]);

export const EnvelopeSchema = z.object({
  message_id: z.string().uuid(),
  schema_version: z.string(),
  type: z.string(),
  occurred_at: z.string().datetime(),
  correlation_id: z.string().uuid(),
  causation_id: z.string().uuid().optional(),
  actor: z
    .object({
      id: z.string(),
      role: ActorRoleSchema,
    })
    .optional(),
  tenant: z
    .object({
      sgi_id: z.string().optional(),
    })
    .optional(),
  environment: EnvironmentSchema,
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;

export function createEnvelope<T>(input: {
  type: string;
  correlation_id: string;
  payload: T;
  environment: z.infer<typeof EnvironmentSchema>;
  schema_version?: string;
  causation_id?: string;
  actor?: z.infer<typeof EnvelopeSchema>["actor"];
  tenant?: z.infer<typeof EnvelopeSchema>["tenant"];
  message_id?: string;
  occurred_at?: string;
}): Envelope & { payload: T } {
  return {
    message_id: input.message_id ?? crypto.randomUUID(),
    schema_version: input.schema_version ?? "1.0",
    type: input.type,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    correlation_id: input.correlation_id,
    causation_id: input.causation_id,
    actor: input.actor,
    tenant: input.tenant,
    environment: input.environment,
    payload: input.payload,
  };
}
