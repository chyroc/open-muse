import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { zhCN } from "../../shared/locales/zh-CN";
import { SecureStorage } from "../ui/SecureStorage";
import { vaultAccount } from "./account";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});
async function client() {
  const value = new Client({
    database: new LocalDatabase(`mac-secrets-${crypto.randomUUID()}`),
    fetcher: vi.fn(async () => {
      throw new Error("This test must not reach the cloud");
    }),
    account: vaultAccount(async () =>
      JSON.stringify({
        kind: "api_key",
        apiKey: `secrets-${crypto.randomUUID()}`,
        project: "test",
      }),
    ),
  });
  await value.restore();
  return value;
}
const button = (label: string) =>
  [...host!.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  )!;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Mac secure storage", () => {
  it("adds a secret limited to the listed websites and never shows its value", async () => {
    const value = await client();
    vi.spyOn(value, "secureCredentials").mockResolvedValue([]);
    const add = vi
      .spyOn(value, "addSecureCredential")
      .mockResolvedValue([
        { id: "c1", name: "GITHUB_TOKEN", hosts: ["api.github.com"] },
      ]);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<SecureStorage client={value} />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    await act(async () => button("Add").click());
    const [name, secret, hosts] = [
      ...host.querySelectorAll<HTMLInputElement>("dialog input"),
    ];
    expect(secret.type).toBe("password");
    await type(name, "GITHUB_TOKEN");
    await type(secret, "ghp_example");
    await type(hosts, "api.github.com, *.githubusercontent.com");
    await act(async () => button("Save").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(add).toHaveBeenCalledWith({
      name: "GITHUB_TOKEN",
      value: "ghp_example",
      hosts: ["api.github.com", "*.githubusercontent.com"],
    });
    expect(host.querySelector("dialog")).toBeNull();
    expect(host.textContent).toContain("GITHUB_TOKEN");
    expect(host.textContent).toContain("Only for api.github.com");
    expect(host.textContent).not.toContain("ghp_example");
  });
  it("removes a secret only after confirming", async () => {
    const value = await client();
    vi.spyOn(value, "secureCredentials").mockResolvedValue([
      { id: "c1", name: "API_KEY", hosts: [] },
    ]);
    const remove = vi
      .spyOn(value, "removeSecureCredential")
      .mockResolvedValue([]);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<SecureStorage client={value} />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(host.textContent).toContain("For any website");
    await act(async () => button("Remove").click());
    expect(remove).not.toHaveBeenCalled();
    await act(async () => button("Confirm").click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(remove).toHaveBeenCalledWith("c1");
    expect(host.textContent).not.toContain("API_KEY");
  });
  it("translates its copy", () => {
    for (const [, key] of readFileSync(
      "macos/ui/SecureStorage.tsx",
      "utf8",
    ).matchAll(/\bt\(\s*"([^"]+)"/g))
      expect(zhCN[key], key).toBeTruthy();
  });
});
