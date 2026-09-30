import { digest, mac, bytesToHex } from "./crypto";

// Volcano V4 signing without Node dependencies. Host is signed but the browser
// supplies the actual header; setting a forbidden Host header breaks fetch.
export function signAction(
  credentials: { accessKeyId: string; secretKey: string; sessionToken: string },
  host: string,
  params: Record<string, string>,
  body: string,
  iam = false,
  now = new Date(),
) {
  const datetime = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const region = iam ? "cn-north-1" : "cn-beijing";
  const service = iam ? "iam" : "ark";
  const scope = `${datetime.slice(0, 8)}/${region}/${service}/request`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-content-sha256": digest(body),
    "x-date": datetime,
    "x-security-token": credentials.sessionToken,
  };
  const names = Object.keys(headers)
    .filter((key) => key !== "content-type")
    .sort();
  const query = new URLSearchParams(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  const canonical = [
    "POST",
    "/",
    query,
    names
      .map((key) => `${key}:${headers[key].trim().replace(/\s+/g, " ")}`)
      .join("\n") + "\n",
    names.join(";"),
    digest(body),
  ].join("\n");
  const key = mac(
    mac(mac(mac(credentials.secretKey, datetime.slice(0, 8)), region), service),
    "request",
  );
  const signature = bytesToHex(
    mac(key, `HMAC-SHA256\n${datetime}\n${scope}\n${digest(canonical)}`),
  );
  delete headers.host;
  headers.authorization = `HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return headers;
}
