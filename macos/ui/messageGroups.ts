// Consecutive bubbles from the same side, sent within two minutes of each
// other, read as one group: they sit closer together and tuck the corners
// they share. A reaction or a gap in time starts a new group.
export const messageGroup = {
  windowMs: 120_000,
};

export type GroupItem = {
  side: "user" | "agent";
  at?: string;
  reacted?: boolean;
};

export type GroupLink = { prev: boolean; next: boolean };

const time = (value?: string) => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

export function canGroup(before: GroupItem, after: GroupItem) {
  if (before.side !== after.side || before.reacted || after.reacted)
    return false;
  const start = time(before.at);
  const end = time(after.at);
  if (start === undefined || end === undefined) return false;
  const gap = end - start;
  return gap >= 0 && gap < messageGroup.windowMs;
}

export function groupLinks(items: GroupItem[]): GroupLink[] {
  const joined = items.map(
    (item, index) => index > 0 && canGroup(items[index - 1], item),
  );
  return items.map((_, index) => ({
    prev: joined[index],
    next: joined[index + 1] === true,
  }));
}

// A time label sits above the first message, above the first message of a
// new calendar day, and above any message sent more than half an hour after
// the one before it.
export const timeMarker = {
  gapMs: 30 * 60_000,
};

const dayOf = (at: number) => new Date(at).toDateString();

export function timeMarkers(times: (string | undefined)[]) {
  let previous: number | undefined;
  return times.map((value) => {
    const at = time(value);
    if (at === undefined) return false;
    const marked =
      previous === undefined ||
      dayOf(at) !== dayOf(previous) ||
      at - previous > timeMarker.gapMs;
    previous = at;
    return marked;
  });
}

// Today shows only the time; another day adds the month and day, and another
// year the year too.
export function timeMarkerLabel(
  value: string,
  locale: string,
  now = Date.now(),
) {
  const at = time(value);
  if (at === undefined) return "";
  const date = new Date(at);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(locale, {
    ...(sameDay
      ? {}
      : {
          month: "short",
          day: "numeric",
          ...(date.getFullYear() === today.getFullYear()
            ? {}
            : { year: "numeric" }),
        }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
