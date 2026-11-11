import { describe, expect, it } from "vitest";
import { areaPath, niceMax, smoothPath, toPoints } from "./chart";

describe("chart helpers", () => {
  it("rounds the top of the scale up to a tidy number", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(2300)).toBe(2500);
    expect(niceMax(4100)).toBe(5000);
  });

  it("places values from the bottom up", () => {
    expect(toPoints([0, 50, 100], 200, 100, 100)).toEqual([
      [0, 100],
      [100, 50],
      [200, 0],
    ]);
  });

  it("draws a smooth line and closes the area to the floor", () => {
    const points = toPoints([0, 100, 0], 100, 50, 100);
    const line = smoothPath(points, 50);
    expect(line.startsWith("M0,50 C")).toBe(true);
    expect(line.split(" C")).toHaveLength(3);
    expect(areaPath(points, 50).endsWith("L100,50 L0,50 Z")).toBe(true);
    expect(smoothPath([], 50)).toBe("");
  });
});
