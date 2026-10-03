import { z } from "zod";

// Calendar, Reminders, and Contacts on the person's iPhone, read by the Open
// Muse iPhone app. Only reads: nothing is created, changed, or deleted. The
// person approves every call in the app; nothing here is approved
// automatically.
export const iphonePersonalTool = "iphone_personal";
export const isIphoneTool = (name?: string) => name === iphonePersonalTool;

// One tool for the three sources, which keeps the agent's custom tools within
// their limit.
export const iphoneToolSpecs = [
  {
    type: "custom",
    name: iphonePersonalTool,
    description:
      "Read from the person's iPhone: their schedule from the Calendar app, their open reminders from the Reminders app, or people in the Contacts app (names, organization, phone numbers, emails, birthday). Read-only: it never creates, changes or deletes anything. Use it when the person asks about their events, availability or to-dos, or refers to someone whose contact details you need, and has not pointed you to another source such as Lark. The person approves each call in the Open Muse iPhone app, so it may wait until the app is open; if declined or unavailable, say so and do not try another way.",
    input_schema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["calendar", "reminders", "contacts"],
          description:
            "calendar reads events; reminders reads reminders that are not completed; contacts looks people up.",
        },
        from: {
          type: "string",
          maxLength: 40,
          description:
            "calendar only: ISO 8601 start. Defaults to now. The range spans at most 92 days.",
        },
        to: {
          type: "string",
          maxLength: 40,
          description:
            "calendar: ISO 8601 end, defaulting to seven days after from. reminders: only those due by then (all open reminders when omitted).",
        },
        query: {
          type: "string",
          maxLength: 200,
          description:
            "calendar and reminders: only items whose title, location or notes contain this. contacts (required): a name or part of one, a phone number, or an email.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "At most this many items; contacts return at most 20.",
        },
      },
      required: ["source"],
      additionalProperties: false,
    },
  },
] as const;

const personalInput = z
  .object({
    source: z.enum(["calendar", "reminders", "contacts"]),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type IphoneRequest = z.infer<typeof personalInput>;

// A pending call's input, or undefined when it is not one this app can read.
export function parseIphoneRequest(event: {
  name?: string;
  input?: unknown;
}): IphoneRequest | undefined {
  if (event.name !== iphonePersonalTool) return undefined;
  const input = personalInput.safeParse(event.input);
  if (!input.success) return undefined;
  if (input.data.source === "contacts" && !input.data.query?.trim())
    return undefined;
  return input.data;
}

// The permission each request needs on the iPhone.
export type IphoneSource = IphoneRequest["source"];
export const iphoneSource = (request: IphoneRequest): IphoneSource =>
  request.source;

// The tool result when the person declines; the agent is told not to retry.
export const iphoneDeclined =
  "The person declined this request in the Open Muse iPhone app. Do not try another way.";
export const iphoneInvalid =
  "The Open Muse iPhone app could not read this request.";
