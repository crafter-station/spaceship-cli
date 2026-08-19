import { danger, warn, ok, muted } from "../cli/platform/style.js";

/**
 * Expiry has a counterintuitive direction: a *large* number of days is good and
 * a small one is bad, which is the opposite of what a reader assumes when a
 * number sits next to a name. A hand-written comparison at each call site gets
 * the sign wrong eventually, so the ordering and the labelling live here, with
 * tests, and nowhere else.
 */

export type Urgency = "expired" | "critical" | "soon" | "watch" | "safe";

/**
 * Thresholds follow the registry lifecycle rather than round numbers: 30 days
 * is the last window in which a transfer out can still complete, and 90 is when
 * a renewal decision stops being urgent.
 */
const THRESHOLDS: { max: number; urgency: Urgency }[] = [
  { max: 0, urgency: "expired" },
  { max: 7, urgency: "critical" },
  { max: 30, urgency: "soon" },
  { max: 90, urgency: "watch" },
];

export function daysUntil(date: string, now: Date = new Date()): number {
  const target = new Date(date).getTime();
  const millisPerDay = 86_400_000;
  return Math.floor((target - now.getTime()) / millisPerDay);
}

export function urgencyOf(days: number): Urgency {
  for (const { max, urgency } of THRESHOLDS) {
    if (days <= max) return urgency;
  }
  return "safe";
}

/** Sorts most urgent first. Never inline this comparison. */
export function byUrgency<T>(getDays: (row: T) => number) {
  return (a: T, b: T): number => getDays(a) - getDays(b);
}

/**
 * A phrase, not a number: "expires in 3 days" needs no interpretation, while a
 * bare `3` next to a domain reads as a quantity of something.
 */
export function expiryPhrase(days: number): string {
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return "expires today";
  return `expires in ${days}d`;
}

export function paintUrgency(urgency: Urgency, text: string): string {
  switch (urgency) {
    case "expired":
    case "critical":
      return danger(text);
    case "soon":
      return warn(text);
    case "watch":
      return ok(text);
    case "safe":
      return muted(text);
  }
}
