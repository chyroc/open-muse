import { Component, type ReactNode } from "react";
import { t } from "../../shared/i18n";

// A replaced native bundle can invalidate a lazy chunk in an already-open view.
// Keep navigation available and require an explicit reload; never retry writes.
export class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <section className="empty-state" role="alert">
        <h3>{t("Could not open your workspace")}</h3>
        <button className="pill-button" onClick={() => location.reload()}>
          {t("Try again")}
        </button>
      </section>
    ) : (
      this.props.children
    );
  }
}
