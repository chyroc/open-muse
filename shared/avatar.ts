// Looks the companion can take, kept as the avatar property of IDENTITY.md.
// Each changes only the color of its fur; the face stays the same.
export const avatarStyles = [
  "classic",
  "cocoa",
  "snow",
  "blush",
  "mint",
  "sky",
] as const;
export type AvatarStyle = (typeof avatarStyles)[number];

// How the companion is told about them.
export const avatarInstructions = `IDENTITY.md may also hold an avatar property choosing how you look in the app. The available looks are: classic (cream fur, the default), cocoa (brown fur), snow (white fur), blush (pink fur), mint (green fur) and sky (blue fur). When the person asks to change how you look, set avatar to the closest of these and tell them which one you chose; if nothing is close, name the available looks instead of promising another. Change only the avatar property, keep the JSON format and the name, and read the file back before saying it changed. Describe the look in the person's words rather than by its property value; the app shows the new look by itself, so do not ask them to refresh.`;
