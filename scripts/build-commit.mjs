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

// The version a release is published under: the commit's date in Beijing
// time and its short hash, as 20261009-fe0e53a. Install order comes from the
// commit count (Android versionCode, Mac build number), not from this.
export function releaseVersion(commit = "HEAD", cwd = process.cwd()) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TZ: "Asia/Shanghai" },
    }).trim();
  const date = git(
    "show",
    "-s",
    "--format=%cd",
    "--date=format-local:%Y%m%d",
    commit,
  );
  return `${date}-${git("rev-parse", "--short=7", commit)}`;
}
