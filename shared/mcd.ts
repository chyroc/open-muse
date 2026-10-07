// McDonald's China publishes a remote MCP server the agent can call once the
// person connects it: a Streamable HTTP endpoint reached with a bearer token.
// The token is obtained by signing in on McDonald's own page in the iPhone
// app; here we only hold the endpoint and the markers that identify the
// connection among the workspace's vault credentials.
export const MCD_MCP_URL = "https://mcp.mcd.cn";

// Shown on the vault credential so it is recognizable in MA; kept in English
// like the other resource names.
export const MCD_CREDENTIAL_NAME = "McDonald's";

// Metadata key and value that tag the one vault credential holding this
// connection, so it can be listed and removed without touching the person's
// other secrets.
export const MCD_CONNECTOR_KEY = "open_muse_connector";
export const MCD_CONNECTOR_VALUE = "mcd";

export const isMcdCredential = (credential: {
  auth?: { type?: string };
  metadata?: Record<string, string>;
}) =>
  credential.auth?.type === "static_bearer" &&
  credential.metadata?.[MCD_CONNECTOR_KEY] === MCD_CONNECTOR_VALUE;
