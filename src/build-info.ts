// The commit this app was built from, shown as its version; empty outside a
// Git checkout. A "-modified" suffix marks uncommitted changes in the build.
export const buildCommit =
  (import.meta.env.VITE_OPEN_MUSE_COMMIT as string | undefined) ?? "";
