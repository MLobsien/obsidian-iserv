/**
 * Mobile-Gate-Entscheidungen (ADR-0009): Welche Features hängen an Node/
 * Electron (Node-https-Transport, safeStorage-Keychain) und sind deshalb auf
 * Obsidian Mobile deaktiviert — und welche laufen vault-only (queue.json,
 * GradeStore, StudyPlan-Note, NoticeCenter) und bleiben aktiv.
 *
 * obsidian-frei: reine Daten + Entscheidungsfunktion, Tests mocken nur
 * Features, kein Obsidian-Import.
 */

export type MobileGatedFeature =
  | "sync-all"
  | "job-poll"
  | "mail-sync"
  | "credentials-modal"
  | "battle-test";

/** Features, die Node/Electron brauchen (Node-https, safeStorage) → mobile GESPERRT. */
export const MOBILE_GATED_FEATURES: MobileGatedFeature[] = [
  "sync-all",
  "job-poll",
  "mail-sync",
  "credentials-modal",
  "battle-test",
];

/** Features, die vault-only laufen (dynamische Views, queue.json, data.json) → mobile AKTIV. */
export const MOBILE_ALLOWED_FEATURES = [
  "review-queue-ui",
  "grade-store",
  "study-plan-note",
  "notice-center",
  "sidebar-view",
  "dashboard-view",
] as const;

/** Dezente Ablweis-Meldung für gesperrte Aktionen (NoticeCenter notifyOnce). */
export const MOBILE_DESKTOP_REQUIRED_NOTICE =
  "Funktion benötigt Desktop (Netzwerk).";

/** Gate-Entscheidung: true = Feature auf mobile deaktiviert. */
export function isFeatureGatedOnMobile(feature: MobileGatedFeature): boolean {
  return MOBILE_GATED_FEATURES.includes(feature);
}
