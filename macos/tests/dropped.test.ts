import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { droppedFiles } from "../ui/dropped";

describe("files dropped on the floating pill", () => {
  it("rebuilds files from the shell's payload", async () => {
    const files = droppedFiles([
      { name: "note.txt", type: "text/plain", data: btoa("hello") },
      { name: "", type: "text/plain", data: btoa("nameless") },
      { name: "broken.bin", type: "", data: "%%%" },
      "not a file",
    ]);
    expect(files.map((file) => file.name)).toEqual(["note.txt"]);
    expect(files[0].type).toBe("text/plain");
    expect(await files[0].text()).toBe("hello");
  });
  it("takes at most the composer's attachment count", () => {
    const many = Array.from({ length: 6 }, (_, index) => ({
      name: `${index}.txt`,
      type: "text/plain",
      data: btoa("x"),
    }));
    expect(droppedFiles(many)).toHaveLength(4);
    expect(droppedFiles(undefined)).toEqual([]);
  });
  it("is fed only by the shell, which reads small regular files", () => {
    const swift = readFileSync("macos/OpenMuse.swift", "utf8");
    expect(swift).toContain("registerForDraggedTypes([.fileURL])");
    expect(swift).toContain("(values.fileSize ?? .max) <= 10 * 1024 * 1024");
    expect(swift).toContain("muse-dropped-files");
    for (const lang of ["en", "zh-Hans"])
      expect(
        readFileSync(`macos/${lang}.lproj/Localizable.strings`, "utf8"),
      ).toContain('"Drop files" =');
  });
});
