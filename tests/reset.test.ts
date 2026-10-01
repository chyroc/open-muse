import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { resetDevice } from "../src/direct/reset";
import { LocalDatabase } from "../src/direct/storage";
import { t } from "../shared/i18n";

const vault = () => {
  let value = "saved-login";
  return {
    read: vi.fn(async () => value),
    write: vi.fn(async (next: string) => {
      value = next;
    }),
  };
};

describe("Device reset", () => {
  it("removes saved logins and every local record", async () => {
    const db = new LocalDatabase();
    await db.set("owner:checkin:v1", { enabled: true, records: [] });
    const direct = vault();
    const background = vault();
    await resetDevice([direct, background]);
    expect(direct.write).toHaveBeenCalledWith("");
    expect(background.write).toHaveBeenCalledWith("");
    expect(await direct.read()).toBe("");
    // The open connection closed for the deletion; a fresh one sees nothing.
    expect(await new LocalDatabase().get("owner:checkin:v1")).toBeUndefined();
  });

  it("still clears what it can and reports what it could not", async () => {
    const locked = {
      read: async () => "x",
      write: vi.fn(async () => {
        throw new Error("locked");
      }),
    };
    const other = vault();
    await expect(resetDevice([locked, other])).rejects.toThrow(
      "could not be removed",
    );
    expect(other.write).toHaveBeenCalledWith("");
    expect(t("Reset this device", {}, "zh-CN")).toBe("重置此设备");
  });
});
