import { formatLocale } from "../shared/i18n";
import type { InspirationChart } from "../shared/inspiration";

// A few figures a post compares, as labelled bars in a light card: the
// largest in ink, the rest in blue, percentages against a full bar and
// other units against the largest.
export function PostChart({ chart }: { chart: InspirationChart }) {
  const largest = Math.max(...chart.items.map((item) => item.value));
  const scale = chart.unit === "%" ? Math.max(100, largest) : largest || 1;
  const number = new Intl.NumberFormat(formatLocale(), {
    maximumFractionDigits: 2,
  });
  return (
    <figure className="post-chart" aria-label={chart.title}>
      <figcaption>{chart.title}</figcaption>
      <ul>
        {chart.items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <span className="post-chart-label">{item.label}</span>
            <strong>
              {number.format(item.value)}
              {chart.unit}
            </strong>
            <span className="post-chart-track" aria-hidden="true">
              <span
                className={item.value === largest ? "lead" : undefined}
                style={{ width: `${(item.value / scale) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      {chart.note && <p>{chart.note}</p>}
    </figure>
  );
}
