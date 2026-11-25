/**
 * Event categories.
 *
 * The five built-ins always exist; anything the user adds is stored as a JSON array in the
 * `settings` table under `eventCategories` (the same key/value bag the desktop app uses, so it
 * travels with a JSON backup). Only the additions are stored — removing every custom category
 * leaves the built-ins untouched.
 */
export const DEFAULT_EVENT_CATEGORIES = ["個人", "工作", "社交", "健康", "學習"];

export const EVENT_CATEGORIES_KEY = "eventCategories";

const clean = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const name = value.trim().slice(0, 12);
    if (!name || seen.has(name) || DEFAULT_EVENT_CATEGORIES.includes(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
};

export const readCustomEventCategories = (
  settings: Record<string, string> | undefined,
): string[] => {
  const raw = settings?.[EVENT_CATEGORIES_KEY];
  if (!raw) return [];
  try {
    return clean(JSON.parse(raw));
  } catch {
    return [];
  }
};

export const serializeEventCategories = (custom: string[]): string =>
  JSON.stringify(clean(custom));
