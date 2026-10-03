import { execFileSync } from "node:child_process";

// The commit an app build comes from, shown as its version. A build with
// uncommitted changes to tracked files says so; outside a Git checkout the
// version is empty and the apps show none.
export function buildCommit(cwd = process.cwd()) {
  try {
    const git = (...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    const commit = git("rev-parse", "--short=7", "HEAD");
    const changed = git("status", "--porcelain", "--untracked-files=no");
    return changed ? `${commit}-modified` : commit;
  } catch {
    return "";
  }
}
