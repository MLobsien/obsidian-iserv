import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getIsMobile, setIsMobileProvider } from "./platform";

describe("platform wrapper (src-side)", () => {
  beforeEach(() => setIsMobileProvider(null));
  afterEach(() => setIsMobileProvider(null));

  it("default: Node-Test-Umfeld ist kein Mobile", () => {
    expect(getIsMobile()).toBe(false);
  });
  it("injectable: mobile an/aus", () => {
    setIsMobileProvider(() => true);
    expect(getIsMobile()).toBe(true);
    setIsMobileProvider(() => false);
    expect(getIsMobile()).toBe(false);
  });
});
