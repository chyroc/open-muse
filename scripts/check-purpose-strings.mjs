// Fail when a built app's purpose strings (Info.plist NS…UsageDescription)
// would show as placeholders, which App Review rejects automatically: an
// empty string, the key name itself, or a language whose InfoPlist.strings
// leaves one out. App extensions are checked too.
//
// Usage: node scripts/check-purpose-strings.mjs path/to/App.app
// Also exported for the release scripts.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// Any plist, binary or text, or .strings file as JSON.
const read = (file) =>
  JSON.parse(
    execFileSync("plutil", ["-convert", "json", "-o", "-", file], {
      encoding: "utf8",
    }),
  );

const placeholder = (key, value) =>
  typeof value !== "string" || !value.trim() || value.trim() === key;

function checkBundle(bundle) {
  // macOS bundles keep everything under Contents/.
  const contents = existsSync(path.join(bundle, "Contents"))
    ? path.join(bundle, "Contents")
    : bundle;
  const resources = existsSync(path.join(contents, "Resources"))
    ? path.join(contents, "Resources")
    : contents;
  const info = read(path.join(contents, "Info.plist"));
  const keys = Object.keys(info).filter((key) =>
    key.endsWith("UsageDescription"),
  );
  const problems = keys
    .filter((key) => placeholder(key, info[key]))
    .map((key) => `Info.plist: ${key} = ${JSON.stringify(info[key])}`);
  const languages = readdirSync(resources).filter((entry) =>
    entry.endsWith(".lproj"),
  );
  for (const language of languages) {
    const file = path.join(resources, language, "InfoPlist.strings");
    if (!existsSync(file)) continue;
    const strings = read(file);
    for (const [key, value] of Object.entries(strings))
      if (placeholder(key, value))
        problems.push(`${language}: ${key} = ${JSON.stringify(value)}`);
    // A language that leaves a purpose string out shows that one in the
    // development language, or as the key when the catalog had none.
    for (const key of keys)
      if (!(key in strings)) problems.push(`${language}: ${key} is missing`);
  }
  console.log(
    `${path.basename(bundle)}: ${keys.length} purpose strings, ${languages.length} languages`,
  );
  return problems.map((problem) => `${path.basename(bundle)} ${problem}`);
}

export function checkPurposeStrings(app) {
  const plugins = [
    path.join(app, "PlugIns"),
    path.join(app, "Contents/PlugIns"),
  ]
    .filter(existsSync)
    .flatMap((directory) =>
      readdirSync(directory)
        .filter((entry) => entry.endsWith(".appex"))
        .map((entry) => path.join(directory, entry)),
    );
  const problems = [app, ...plugins].flatMap(checkBundle);
  if (problems.length)
    throw new Error(
      `Placeholder purpose strings:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv[2]) {
    console.error("Usage: node scripts/check-purpose-strings.mjs <App.app>");
    process.exit(2);
  }
  try {
    checkPurposeStrings(path.resolve(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
