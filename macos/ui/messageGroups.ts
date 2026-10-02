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
