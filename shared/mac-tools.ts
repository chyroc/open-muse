// Custom tools the Open Muse desktop app runs on the user's own computer: the
// Mac app on a Mac, and the Windows app on a Windows PC, under the same names
// (an agent may have only eight custom tools). MA pauses the session with
// requires_action until that app answers, so these are declared on the agent
// but executed only by the desktop client, after the user approves.
const point = {
  x: {
    type: "number",
    minimum: 0,
    description: "Horizontal pixel in the latest mac_screenshot.",
  },
  y: {
    type: "number",
    minimum: 0,
    description: "Vertical pixel in the latest mac_screenshot.",
  },
};
const when =
  "Use only when the user asks you to look at or operate their computer (their Mac, or their Windows PC), an app on it, or their own browser on it. The user approves each call on that computer; if declined or unavailable, say so and do not try another way.";

export const macTools = [
  {
    type: "custom",
    name: "mac_screenshot",
    description: `Capture the main display of the user's computer as an image. Coordinates for mac_action are pixels of the latest screenshot, origin at the top left. ${when}`,
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "custom",
    name: "mac_action",
    description: `Click, move, drag, scroll, type text or press a key combination on the user's computer, then return a fresh screenshot. Take a screenshot first and act on what it shows. Never type passwords or payment details, and never confirm purchases, sends or deletions the user did not ask for. ${when}`,
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "click",
            "double_click",
            "right_click",
            "move",
            "drag",
            "scroll",
            "type",
            "key",
          ],
        },
        ...point,
        to_x: {
          type: "number",
          minimum: 0,
          description: "Drag end, horizontal pixel.",
        },
        to_y: {
          type: "number",
          minimum: 0,
          description: "Drag end, vertical pixel.",
        },
        amount: {
          type: "integer",
          minimum: -50,
          maximum: 50,
          description: "Lines to scroll; positive scrolls down.",
        },
        text: { type: "string", maxLength: 2000, description: "Text to type." },
        keys: {
          type: "string",
          maxLength: 40,
          description:
            "A key or combination such as return, esc or cmd+c on a Mac, enter or ctrl+c on Windows.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    type: "custom",
    name: "mac_open",
    description: `Open an app by name, a web address in the user's default browser, or a file by absolute path (such as /Users/... on a Mac or C:\\Users\\... on Windows) on the user's computer. ${when}`,
    input_schema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          minLength: 1,
          maxLength: 2048,
          description: "App name, https address, or absolute file path.",
        },
      },
      required: ["target"],
      additionalProperties: false,
    },
  },
  {
    type: "custom",
    name: "mac_apps",
    description: `List the apps running on the user's computer, which one is in front, and its visible windows. ${when}`,
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "custom",
    name: "mac_calendar",
    description:
      "Read the user's schedule from the Calendar app, or their open reminders from the Reminders app, on their Mac; on a Windows PC, the calendar and open tasks of classic Outlook. Read-only: it never creates, changes or deletes anything. Use when the user asks about their events, schedule, availability or to-dos while writing from the Mac or Windows app, or asks for their computer's calendar, and has not pointed you to another calendar such as Lark. When they write from the iPhone app, use iphone_personal instead. The user approves each call on that computer and can turn this off; if declined or unavailable, say so and do not try another way.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["events", "reminders"],
          description:
            "events reads calendar events; reminders reads reminders that are not completed.",
        },
        from: {
          type: "string",
          maxLength: 40,
          description:
            "ISO 8601 start, for events. Defaults to now. The range spans at most 92 days.",
        },
        to: {
          type: "string",
          maxLength: 40,
          description:
            "ISO 8601 end. Defaults to seven days after from for events; for reminders, only those due by then are returned (all open reminders when omitted).",
        },
        query: {
          type: "string",
          maxLength: 200,
          description:
            "Only items whose title, location or notes contain this.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  {
    type: "custom",
    name: "mac_location",
    description:
      "Find the user's approximate current location from their computer: a position rounded to about a kilometre, with the city, region, country and time zone when known. Use when the answer depends on where the user is now, such as local weather, nearby places or local time, and they have not said where they are. The user approves each call on that computer and can turn this off; if declined or unavailable, ask them instead.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export type MacToolName = (typeof macTools)[number]["name"];
export const macToolNames = macTools.map((tool) => tool.name) as MacToolName[];
