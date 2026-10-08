import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getIsMobile, setIsMobileProvider } from "../../src/mobile/platform";
import {
  isFeatureGatedOnMobile,
  MOBILE_GATED_FEATURES,
  MOBILE_ALLOWED_FEATURES,
  MOBILE_DESKTOP_REQUIRED_NOTICE,
} from "../../src/mobile/guard";

describe("mobile platform wrapper", () => {
  beforeEach(() => setIsMobileProvider(null));
  afterEach(() => setIsMobileProvider(null));

  it("default provider: ohne Obsidian-Umgebung (Node-Test) false", () => {
    expect(getIsMobile()).toBe(false);
  });

  it("injected provider: iOS mobile", () => {
    setIsMobileProvider(() => true);
    expect(getIsMobile()).toBe(true);
  });

  it("injected provider: desktop", () => {
    setIsMobileProvider(() => false);
    expect(getIsMobile()).toBe(false);
  });

  it("reset auf default nach null", () => {
    setIsMobileProvider(() => true);
    setIsMobileProvider(null);
    expect(getIsMobile()).toBe(false);
  });
});

describe("mobile gate decisions (ADR-0009)", () => {
  it("Node/Electron-Features sind auf mobile gesperrt", () => {
    for (const f of MOBILE_GATED_FEATURES) {
      expect(isFeatureGatedOnMobile(f)).toBe(true);
    }
  });

  it("sync-all, job-poll, mail-sync, battle-test, exercise-submit, extern-open sind die Gate-Liste (credentials-modal läuft mobile über MobileCredStore)", () => {
    expect(MOBILE_GATED_FEATURES).toEqual([
      "sync-all",
      "job-poll",
      "mail-sync",
      "battle-test",
      "exercise-submit",
      // Issue #17-P3: Electron remote shell openPath ist Desktop-only.
      "extern-open",
    ]);
  });

  it("vault-only-Feature-Set ist definiert und scharf", () => {
    expect(MOBILE_ALLOWED_FEATURES).toContain("review-queue-ui");
    expect(MOBILE_ALLOWED_FEATURES).toContain("grade-store");
    expect(MOBILE_ALLOWED_FEATURES).toContain("study-plan-note");
    expect(MOBILE_ALLOWED_FEATURES).toContain("notice-center");
    // Vault-only-Features kommen nicht in der Node-Gate-Liste vor:
    for (const f of MOBILE_ALLOWED_FEATURES) {
      expect(MOBILE_GATED_FEATURES).not.toContain(f);
    }
  });

  it("dezent-Notice-Text für gesperrte Aktionen", () => {
    expect(MOBILE_DESKTOP_REQUIRED_NOTICE).toMatch(/Desktop/);
  });
});
