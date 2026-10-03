// Illustrations for the Ideas catalog, keyed by idea id, with the size in
// points each is drawn at inside its 44pt square.
const files = import.meta.glob<string>("./assets/ideas/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});

const sizes: Record<string, [number, number]> = {
  "fare-drop": [41.3, 42.0],
  "occasion-planner": [34.0, 44.7],
  "inbox-triage": [43.7, 31.0],
  "forgotten-subscriptions": [41.3, 42.3],
  "pet-care": [41.7, 41.7],
  "family-trivia-night": [33.7, 43.3],
  reconnect: [42.7, 28.7],
  "document-photos": [42.0, 41.3],
  "inbox-day-plan": [41.3, 42.0],
  returns: [38.7, 41.7],
  "habit-triggers": [44.3, 20.3],
  "equipment-workouts": [44.0, 29.0],
  "meal-photos": [41.7, 33.3],
  "follow-up-visits": [27.0, 44.7],
  "savings-goal": [32.0, 42.0],
  "unclaimed-money": [44.0, 30.0],
  "price-drop-refunds": [21.3, 44.7],
  "rewards-cards": [42.3, 35.0],
  "side-by-side": [41.7, 42.0],
  "marketplace-finds": [33.3, 42.0],
  "best-value": [37.0, 42.7],
  "id-renewals": [44.0, 33.0],
  "daily-personality-quiz": [28.0, 44.3],
  "replacement-parts": [42.0, 36.3],
  "street-repairs": [24.3, 44.7],
  "home-project-quotes": [42.3, 37.7],
  moving: [30.0, 42.0],
  "show-tickets": [40.3, 44.7],
  "vibe-booking": [37.0, 42.0],
  "weekend-plans": [42.0, 35.7],
  "hotel-requests": [39.3, 41.7],
  "flight-watch": [43.7, 32.0],
  "trip-planner": [42.7, 32.7],
};

export function ideaIcon(id: string) {
  const src = files[`./assets/ideas/${id}.png`];
  const size = sizes[id];
  return src && size ? { src, width: size[0], height: size[1] } : undefined;
}
