# Cred-Storage: Electron safeStorage + fail-closed + history-scrub (kein data.json-gitignore)

IServ-Credentials (host/user/pass) werden via Electron `safeStorage` gespeichert (macOS Keychain / Windows DPAPI / Linux secret-store gnome-libsecret|kwallet|portal.Secret) — nicht als Plaintext in `data.json`, nicht via `keytar` (seit Dez 2022 archived/unmaintained). `data.json` bleibt getrackt und speichert nur non-cred State; "data.json ist cred-free" ist eine Code-Invariante (Review-gesichert), NICHT per `.gitignore` maskiert — gitignore wäre ein Band-Aid, der Bad Practice verbirgt statt sie zu fixen. Beim ersten Login Runtime-Check `safeStorage.isEncryptionAvailable()` + `getSelectedStorageBackend()`; bei `basic_text`/false → fail-closed (kein Persist) + actionable Setup-Hinweise (gnome-keyring/keepassxc, `org.freedesktop.secrets`, ggf. `--password-store=gnome-libsecret`). NixOS braucht Runtime-Test (T8). Session-Cookie `IServSession` persistiert im Keychain, stilles Re-Login bei Expiry. Altlast-Creds in `data.json`+`nextDue.js` werden aus git-History geschrubbt (`git filter-repo`/BFG + force-push); Passwort-Rotation ist IServ-seitig nur durch Lehrer möglich (kein self-service).

**Status:** accepted

**Considered options:** (a) keytar (archived, native-module liability) — nein; (b) Plaintext/obfuscated in data.json (Status quo, Altlast) — nein; (c) safeStorage + fail-closed — ja. Remediation: gitignore data.json (Band-Aid) — nein; scrub history + cred-free als Code-Invariante — ja.

**Consequences:** Plugin muss safeStorage-Flow + Runtime-Check + fail-closed-Setup-Flow implementieren (T8); history-scrub ist destruktiv (force-push); NixOS-Runtime-Test offen; nextDue.js deprecaten (Plugin = alleiniger Client); Passwort bleibt gültig bis Lehrer rotiert.

## Erweiterung 2026-09-27: MobileCredStore (Obsidian Mobile)

**Status:** accepted (Erweiterung)

Kontext: Obsidian Mobile (iOS/Android) hat kein Electron `safeStorage`; der
Desktop-Store ist dort strukturell nicht vorhanden. Mobile ist Haupteinsatzgebiet
des Plugins (User-Entscheidung) — ein fail-closed-only auf Desktop widerspräche
dem Einsatzziel.

Entscheidung: `MobileCredStore` (`src/client/MobileCredStore.ts`) — WebCrypto
AES-GCM 256 mit einem non-extractable device-key (`generateKey(..., false)`,
kann das Gerät nicht verlassen), gepersistert in IndexedDB (App-Container/
WKWebView-Sandbox). In `data.json` liegt nur der Ciphertext (iv+ct+createdAt);
die cred-free-Invariante bleibt unverändert. Fail-closed analog Desktop:
ohne Key/webcrypto/IndexedDB wird NICHT persistiert
(`MobileEncryptionUnavailableError`). Session-Cookie-Spiegel mit 90d-TTL.
Plattformwahl in `onload` (`getIsMobile()`): Desktop → CredStore (safeStorage),
Mobile → MobileCredStore. Identische IO (save/load/clear/clearAll +
Session-Spiegel) macht beide Stores austauschbar.

Verifiziert: Unit-Tests mit echtem Node-WebCrypto (7); live am echten Obsidian
via obsidian-cli eval — AES-GCM-Roundtrip ok, `extractable=false`, IDB-Key
funktionsäquivalent nach strukturiertem Klon (Identitäts-Vergleich ungeeignet,
CryptoKey wird beim IDB-Get strukturiert geklont). Restrisiko für echtes iOS:
WKWebView-IDB-Persistenz wird erst im iOS-Praxistest belegt.

Konsequenzen: Kein Plaintext-Pfad auf mobile; Verlust des App-Containers
(Gerätewechsel/App-Daten löschen) = Key weg = Ciphertext unlesbar (fail-closed
statt Decryption-Fehler-Loop — load() wirft MobileEncryptionUnavailableError,
UI-Hinweis: Credentials neu eintragen). ADR-0009-Gate-Liste verliert
`credentials-modal` (läuft jetzt über MobileCredStore).
