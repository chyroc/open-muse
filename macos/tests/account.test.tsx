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
    onSignUp = vi.fn(async () => true),
    onRequestReset = vi.fn(async () => true),
    onReset = vi.fn(async () => {});
  await act(async () =>
    root!.render(
      <SupabaseLoginForm
        busy={false}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onRequestReset={onRequestReset}
        onReset={onReset}
      />,
    ),
  );
  return { onSignIn, onSignUp, onRequestReset, onReset };
}
async function input(type: string, value: string) {
  await act(async () => {
    const node = host.querySelector<HTMLInputElement>(
      type === "code" ? 'input[inputmode="numeric"]' : `input[type="${type}"]`,
    )!;
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
  it.each(["en", "zh-Hans"])(
    "resets a forgotten password with an emailed code in %s",
    async (language) => {
      const f = await setup(language);
      const chinese = language.startsWith("zh");
      const button = (label: string) =>
        [...host.querySelectorAll<HTMLButtonElement>("button")].find(
          (node) => node.textContent === label,
        )!;
      await act(async () =>
        button(chinese ? "忘记密码？" : "Forgot password?").click(),
      );
      expect(host.querySelector('input[type="password"]')).toBeNull();
      await input("email", "person@example.com");
      await submit();
      expect(f.onRequestReset).toHaveBeenCalledExactlyOnceWith(
        "person@example.com",
      );
      expect(f.onSignIn).not.toHaveBeenCalled();
      expect(host.textContent).toContain(
        chinese ? "邮件中的验证码" : "Code from the email",
      );
      await input("code", " 123456 ");
      await input("password", "new-private-password");
      await submit();
      expect(f.onReset).toHaveBeenCalledExactlyOnceWith(
        "person@example.com",
        "123456",
        "new-private-password",
      );
      expect(
        host.querySelector<HTMLInputElement>('input[type="password"]')!.value,
      ).toBe("");
      await act(async () =>
        button(chinese ? "返回登录" : "Back to sign in").click(),
      );
      expect(
        button(chinese ? "登录 Open Muse" : "Sign in to Open Muse"),
      ).toBeTruthy();
    },
  );
});
