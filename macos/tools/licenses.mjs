import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function editorLicenseNotices(root) {
  const lock = JSON.parse(
    await readFile(path.join(root, "macos/package-lock.json"), "utf8"),
  );
  const notices = ["Open Muse macOS editor dependencies\n"];
  for (const [directory, info] of Object.entries(lock.packages)) {
    if (!directory || info.dev) continue;
    const folder = path.join(root, "macos", directory);
    const licenses = (await readdir(folder)).filter((name) =>
      /^licen[sc]e(?:\.|$)/i.test(name),
    );
    if (!licenses.length) throw new Error(`Missing license for ${directory}.`);
    notices.push(
      `\n${directory.replace(/^node_modules\//, "")} ${info.version}\n`,
    );
    for (const name of licenses)
      notices.push(await readFile(path.join(folder, name), "utf8"));
  }
  return notices.join("\n");
}
