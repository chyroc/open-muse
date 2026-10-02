import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseLoginForm } from "../../src/SupabaseLoginForm";

let root: Root | undefined, host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});
async function setup(language: string) {
  vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const onSignIn = vi.fn(async () => {}),
    onSignUp = vi.fn(async () => true);
  await act(async () =>
    root!.render(
      <SupabaseLoginForm
        busy={false}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
      />,
    ),
  );
  return { onSignIn, onSignUp };
}
async function input(type: string, value: string) {
  await act(async () => {
    const node = host.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const submit = () =>
  act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
describe("Shared native account login form", () => {
  it.each(["en", "zh-Hant", "fr"])(
    "requires an explicit login and clears the password in %s",
    async (language) => {
      const f = await setup(language);
      expect(f.onSignIn).not.toHaveBeenCalled();
      expect(host.textContent).toContain(
        language.startsWith("zh") ? "账号邮箱" : "Account email",
      );
      await input("email", "person@example.com");
      await input("password", "private-password");
      await submit();
      expect(f.onSignIn).toHaveBeenCalledExactlyOnceWith(
        "person@example.com",
        "private-password",
      );
      expect(
        host.querySelector<HTMLInputElement>('input[type="password"]')!.value,
      ).toBe("");
      expect(f.onSignUp).not.toHaveBeenCalled();
    },
  );
  it("does not submit registration before explicit consent or adopt signup as login", async () => {
    const f = await setup("en");
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
    });
    await input("email", "person@example.com");
    await input("password", "private-password");
    await submit();
    expect(f.onSignUp).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    await submit();
    expect(f.onSignUp).toHaveBeenCalledExactlyOnceWith(
      "person@example.com",
      "private-password",
    );
    expect(f.onSignIn).not.toHaveBeenCalled();
    expect(host.textContent).toContain("not used to identify you");
  });
  it("clears a rejected login's password without creating an unhandled rejection", async () => {
    const f = await setup("en");
    f.onSignIn.mockRejectedValueOnce(new Error("rejected"));
    await input("email", "person@example.com");
    await input("password", "private-password");
    await submit();
    expect(
      host.querySelector<HTMLInputElement>('input[type="password"]')!.value,
    ).toBe("");
  });
});
