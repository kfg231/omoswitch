import { describe, expect, it } from "vitest";
import { isLevelEnabled, setLevelEnabled } from "./thinking";

describe("thinkingLevelMap helpers", () => {
  it("treats base levels as enabled unless null and extended levels only when mapped", () => {
    const map = { minimal: null, max: "max" };
    expect(isLevelEnabled(map, "low")).toBe(true);
    expect(isLevelEnabled(map, "minimal")).toBe(false);
    expect(isLevelEnabled(map, "xhigh")).toBe(false);
    expect(isLevelEnabled(map, "max")).toBe(true);
  });

  it("toggles levels using null for base levels and the level name for extended ones", () => {
    let map = setLevelEnabled({}, "minimal", false);
    expect(map).toEqual({ minimal: null });
    map = setLevelEnabled(map, "xhigh", true);
    expect(map).toEqual({ minimal: null, xhigh: "xhigh" });
    map = setLevelEnabled(map, "minimal", true);
    map = setLevelEnabled(map, "xhigh", false);
    expect(map).toEqual({});
  });
});
