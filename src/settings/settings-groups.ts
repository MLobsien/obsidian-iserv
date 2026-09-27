/**
 * Settings-Gruppen für das IServ-Redesign (T23) — pure, obsidian-frei.
 *
 * Nur Daten: Titel + Key/Type/Name/Desc pro Eintrag. Das Rendern passiert
 * in settings-tab.ts (Obsidian-API), die Tests laufen ohne Obsidian.
 */

/** Erlaubte Input-Typen pro Setting (Invarianten im Test gehärtet). */
export type SettingFieldType = "text" | "toggle" | "textarea" | "select";

export interface SettingSpec {
  /** Key in IServSettings (siehe DEFAULT_SETTINGS in src/main.ts). Teil-Keys
   *  mit Punkt (jobIntervals.core) adressieren verschachtelte Felder. */
  key: string;
  type: SettingFieldType;
  /** Angzeigter Name (Obsidian `Setting.setName`). */
  name: string;
  /** Beschreibung (Obsidian `Setting.setDesc`). */
  desc: string;
  /** Nur type="select": feste Auswahl statt freiem Text (User-Kritik Runde 4:
   *  "In den Settings wird erwartet, dass der User JSON eingibt (wtf)"). */
  options?: { value: string; label: string }[];
}

export interface SettingGroupSpec {
  title: string;
  settings: SettingSpec[];
}

export const SETTING_GROUPS: SettingGroupSpec[] = [
  {
    title: "Konto",
    settings: [
      {
        key: "host",
        type: "text",
        name: "Host",
        desc: "IServ-Instanz",
      },
      {
        key: "user",
        type: "text",
        name: "Benutzer",
        desc: "IServ-Login; Mail-Konto = benutzer@host (abgeleitet). Passwort landet im Keychain.",
      },
      {
        key: "ssl",
        type: "toggle",
        name: "SSL",
        desc: "HTTPS-Verbindung zur IServ-Instanz (Default: an, Port 443).",
      },
      {
        key: "port",
        type: "text",
        name: "Port",
        desc: "Port der IServ-Instanz (Default: 443).",
      },
      {
        key: "credentials",
        type: "text",
        name: "Credentials setzen",
        desc: "Passwort / 2FA über Keychain-Modal setzen (nicht in data.json).",
      },
    ],
  },
  {
    title: "Mail",
    settings: [
      {
        key: "onlySchoolEmails",
        type: "toggle",
        name: "Spam-Filter (nur Schulmails)",
        desc: "Mails von Absendern außerhalb der Schul-Domain (z. B. gymmeck.de) verbergen.",
      },
    ],
  },
  {
    title: "Review-Queue",
    settings: [
      {
        key: "template",
        type: "text",
        name: "Ablage-Template",
        desc: "Zielordner importierter Dateien (Platzhalter {{SUBJECT}}, {{SCHOOLYEAR}} …)",
      },
    ],
  },
  {
    title: "Sonstiges",
    settings: [
      {
        key: "prepWindowBaseDays.Klausur",
        type: "text",
        name: "Vorbereitungsfenster Klausur (Tage)",
        desc: "Tage vor Klausur-Arbeit (ADR-0006, Default 15).",
      },
      {
        key: "prepWindowBaseDays.Klassenarbeit",
        type: "text",
        name: "Vorbereitungsfenster Klassenarbeit (Tage)",
        desc: "Tage vor Klassenarbeit (ADR-0006, Default 10).",
      },
      {
        key: "prepWindowBaseDays.Abitur",
        type: "text",
        name: "Vorbereitungsfenster Abitur (Tage)",
        desc: "Tage vor Abitur (ADR-0006, Default 183).",
      },
      {
        key: "pollMinutes",
        type: "text",
        name: "Poll-Intervall (Minuten)",
        desc: "Legacy-Poll-Intervall (0 = aus); sync läuft über jobIntervals-Module.",
      },
      {
        key: "jobIntervals.core",
        type: "text",
        name: "Sync-Intervall Core (Minuten)",
        desc: "Stundenplan/Vertretungen-Poll (0 = aus; T24/ADR-0005).",
      },
      {
        key: "jobIntervals.mails",
        type: "text",
        name: "Sync-Intervall Mails (Minuten)",
        desc: "Mail-Poll (0 = aus; T24/ADR-0005).",
      },
      {
        key: "jobIntervals.exercises",
        type: "text",
        name: "Sync-Intervall Aufgaben (Minuten)",
        desc: "Aufgaben-Poll (0 = aus; T24/ADR-0005).",
      },
      {
        key: "gradesScale",
        type: "select",
        name: "Notenscale (Notenindex)",
        desc: "Punkte (0–15, Oberstufe) oder Noten (1–6) — ADR-0006.",
        options: [
          { value: "points", label: "Punkte (0–15)" },
          { value: "grades", label: "Noten (1–6)" },
        ],
      },
    ],
  },
];
