import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t } from "../shared/i18n";
import { HealthConnectSheet } from "../src/HealthConnectSheet";

describe("Health connect sheet", () => {
  it("explains connecting Health before the system permission sheet", () => {
    const html = renderToStaticMarkup(
      <HealthConnectSheet
        name="Kit"
        onContinue={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain(`>${t("Health")}</h2>`);
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).toContain("You choose what Kit can read");
    // Connecting covers later reads, and says how to undo it.
    expect(html).toContain("without asking each time");
    expect(html).toContain("disconnect in Connectors");
    expect(html).toContain(`>${t("Continue")}</button>`);
    expect(html).toContain(`>${t("Cancel")}</button>`);
  });
});
