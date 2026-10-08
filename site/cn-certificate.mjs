// Issue or renew the HTTPS certificate of the mainland China download
// domain and install it on its Alibaba Cloud CDN domain. Let's Encrypt
// certificates last 90 days; run this again within that time (a renewal is
// skipped until 30 days before expiry).
//
// Usage: node site/cn-certificate.mjs
//
// Requires lego (brew install lego), a Cloudflare API token that may edit the
// zone's DNS in CLOUDFLARE_API_TOKEN, and the Alibaba Cloud CLI signed in to
// the account that owns the CDN domain (ALIYUN_PROFILE selects a profile).
// The account key and certificates stay in .data/cn-certificate, which is
// ignored; the private key is never printed.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mirrors = JSON.parse(
  readFileSync(path.join(root, "site/mirrors.json"), "utf8"),
);
const domain = new URL(mirrors.cn.base).hostname;
const store = path.join(root, ".data/cn-certificate");
const profile = process.env.ALIYUN_PROFILE
  ? ["--profile", process.env.ALIYUN_PROFILE]
  : [];

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error("Set CLOUDFLARE_API_TOKEN to a token that may edit DNS.");
  process.exit(1);
}
mkdirSync(store, { recursive: true });

execFileSync(
  "lego",
  [
    "run",
    "--accept-tos",
    "--email",
    "support@getopenmuse.com",
    "--dns",
    "cloudflare",
    "--domains",
    domain,
    "--path",
    store,
    "--renew-days",
    "30",
    "--no-random-sleep",
    // Public resolvers see the challenge record; a local one may not.
    "--dns.resolvers",
    "1.1.1.1:53,8.8.8.8:53",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, CF_DNS_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN },
  },
);

const certificate = readFileSync(
  path.join(store, "certificates", `${domain}.crt`),
  "utf8",
);
const key = readFileSync(
  path.join(store, "certificates", `${domain}.key`),
  "utf8",
);
execFileSync(
  "aliyun",
  [
    "cdn",
    "SetCdnDomainSSLCertificate",
    "--DomainName",
    domain,
    "--SSLProtocol",
    "on",
    "--CertType",
    "upload",
    "--CertName",
    `${domain}-${new Date().toISOString().slice(0, 10)}`,
    "--SSLPub",
    certificate,
    "--SSLPri",
    key,
    ...profile,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
console.log(`Installed the certificate for ${domain} on the CDN.`);
