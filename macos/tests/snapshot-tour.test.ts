import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { settingsSections } from "../ui/settings";

describe("Mac snapshot tour", () => {
  const swift = readFileSync("macos/OpenMuse.swift", "utf8");

  it("visits every settings section the settings window offers", () => {
    const listed = /static let tourSections = \[([^\]]+)\]/.exec(swift)?.[1];
    expect(listed).toBeTruthy();
    const ids = [...listed!.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    expect(ids).toEqual(settingsSections.map((section) => section.id));
  });

  it("is compiled only into acceptance builds", () => {
    const tour = swift.slice(swift.indexOf("extension OpenMuseApp {"));
    expect(swift).toContain("#if SNAPSHOT_TOUR\n        startSnapshotTour()");
    expect(swift.lastIndexOf("#if SNAPSHOT_TOUR")).toBeLessThan(
      swift.indexOf("func startSnapshotTour"),
    );
    expect(tour.trimEnd().endsWith("#endif")).toBe(true);
    const build = readFileSync("scripts/build-macos.mjs", "utf8");
    expect(build.replace(/\s+/g, " ")).toContain(
      'process.env.OPEN_MUSE_SNAPSHOT_TOUR === "1" ? ["-D", "SNAPSHOT_TOUR"] : []',
    );
  });
});
