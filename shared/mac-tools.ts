// Custom tools the Open Muse Mac app runs on the user's own Mac. MA pauses the
// session with requires_action until that app answers, so these are declared
// on the agent but executed only by the Mac client, after the user approves.
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
  "Use only when the user asks you to look at or operate their Mac, a Mac app, or their own browser on the Mac. The user approves each call on the Mac; if declined or unavailable, say so and do not try another way.";

export const macTools = [
  {
    type: "custom",
    name: "mac_screenshot",
    description: `Capture the main display of the user's Mac as an image. Coordinates for mac_action are pixels of the latest screenshot, origin at the top left. ${when}`,
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "custom",
    name: "mac_action",
    description: `Click, move, drag, scroll, type text or press a key combination on the user's Mac, then return a fresh screenshot. Take a screenshot first and act on what it shows. Never type passwords or payment details, and never confirm purchases, sends or deletions the user did not ask for. ${when}`,
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
          description: "A key or combination such as return, esc or cmd+c.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    type: "custom",
    name: "mac_open",
    description: `Open an app by name, a web address in the user's default browser, or a file by absolute path on the user's Mac. ${when}`,
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
    description: `List the apps running on the user's Mac, which one is in front, and its visible windows. ${when}`,
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

export type MacToolName = (typeof macTools)[number]["name"];
export const macToolNames = macTools.map((tool) => tool.name) as MacToolName[];
