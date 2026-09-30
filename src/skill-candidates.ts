const root =
  "https://github.com/win4r/MuseAI-Skills/tree/38bbb45a2c5a0f70de975f6387385770b9ad8aac/opt/hatch/skills/";
export const skillCandidates = [
  {
    name: "Markdown / Artifact acceptance",
    status: "Good fit for a rewrite",
    level: "ready",
    path: "artifacts/testing",
    note: "Reference the read-back, rendering, and usability checks after generation. Rework to use MA file tools and our own validation scripts.",
  },
  {
    name: "Wide Research",
    status: "Requires multi-agent support",
    level: "adapt",
    path: "wide-research",
    note: "Standardize research fields, report coverage, and failed items; map to the MA multi-agent configuration.",
  },
  {
    name: "Travel planning / Place search",
    status: "Requires search capability",
    level: "adapt",
    path: "travel-planning",
    note: "The planning flow can be rewritten. Bookings, real-time pricing, and transactions require a separate provider integration.",
  },
  {
    name: "Gmail / Calendar / Notion",
    status: "Requires MCP + OAuth",
    level: "adapt",
    path: "gmail",
    note: "Must replace the Muse CLI and connect accounts in Vault; the documentation itself does not grant access.",
  },
  {
    name: "Goals / Forget",
    status: "Requires persistence and scheduling",
    level: "adapt",
    path: "forget",
    note: "MA Memory can store information; reminders and full forgetting still need app-level scheduling and a data cleanup policy.",
  },
  {
    name: "Device / Muse proprietary capabilities",
    status: "Cannot be used directly",
    level: "blocked",
    path: "device-data",
    note: "HealthKit, wearables, the Muse database, subscriptions, and messaging depend on the original product host and proprietary services.",
  },
].map((item) => ({ ...item, url: root + item.path }));
