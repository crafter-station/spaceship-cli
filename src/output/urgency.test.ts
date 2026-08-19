import { describe, expect, test } from "bun:test";
import { byUrgency, daysUntil, expiryPhrase, urgencyOf } from "./urgency.js";

const NOW = new Date("2026-08-18T00:00:00Z");

describe("daysUntil", () => {
  test("future dates are positive, past dates negative", () => {
    expect(daysUntil("2026-08-28T00:00:00Z", NOW)).toBe(10);
    expect(daysUntil("2026-08-08T00:00:00Z", NOW)).toBe(-10);
  });
});

describe("urgencyOf", () => {
  test("every bucket is reachable", () => {
    const buckets = new Set([-1, 3, 20, 60, 400].map(urgencyOf));
    expect(buckets).toEqual(new Set(["expired", "critical", "soon", "watch", "safe"]));
  });

  test("fewer days is never less urgent than more days", () => {
    const rank = { expired: 0, critical: 1, soon: 2, watch: 3, safe: 4 };
    const days = [-30, -1, 0, 1, 7, 8, 30, 31, 90, 91, 365];
    for (let i = 1; i < days.length; i++) {
      const previous = rank[urgencyOf(days[i - 1] as number)];
      const current = rank[urgencyOf(days[i] as number)];
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  test("boundaries land on the urgent side", () => {
    expect(urgencyOf(0)).toBe("expired");
    expect(urgencyOf(7)).toBe("critical");
    expect(urgencyOf(30)).toBe("soon");
    expect(urgencyOf(90)).toBe("watch");
    expect(urgencyOf(91)).toBe("safe");
  });
});

describe("byUrgency", () => {
  test("sorts the most urgent first, not the largest number", () => {
    const rows = [{ d: 400 }, { d: -5 }, { d: 20 }];
    const sorted = [...rows].sort(byUrgency((r) => r.d));
    expect(sorted.map((r) => r.d)).toEqual([-5, 20, 400]);
  });
});

describe("expiryPhrase", () => {
  test("states direction in words, so a bare number cannot be misread", () => {
    expect(expiryPhrase(-3)).toBe("expired 3d ago");
    expect(expiryPhrase(0)).toBe("expires today");
    expect(expiryPhrase(12)).toBe("expires in 12d");
  });
});
