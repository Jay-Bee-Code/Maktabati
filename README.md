# Library Manager · Gestion de bibliothèque · تسيير المكتبة

**[English](#english) · [Français](#français) · [العربية](#العربية)**

---

## English

Desktop application for library management: Electron + React + Tailwind CSS 4 + Framer Motion + SQLite (better-sqlite3).

### Getting started

```bash
npm install        # installs packages and rebuilds better-sqlite3 for Electron automatically
npm run dev        # development mode: starts Vite, then Electron with --dev (retries until Vite is ready)
npm start          # builds the UI, then runs Electron on the built files (dist/), no dev server
npm test           # all tests (see the note below)
npm run dist       # creates the installer in the release/ folder
```

Requires Node.js 20 or later.

> **Do not run `electron .` directly before `npm run build`:** that is "production mode" and it loads `dist/index.html`; if the file does not exist, an explanation page is shown instead of the UI. Development mode must be requested explicitly with `--dev` (which `npm run dev` does for you).

**First launch:** the administrator account creation screen appears. After that, everyone signs in with their own account.

### Added in version 1.2 (phase 2)

| Feature | Details |
|---|---|
| Loan desk | A scanner screen: member card, then copy barcode, then Enter, and the loan is recorded immediately and the cursor returns to the field. Return mode by barcode, by title or by member name. A session log warns about late items. |
| Barcode per copy | A `copies` table with a unique barcode (`B00012-2`) and a status (good / damaged / lost). Damaged and lost copies cannot be loaned and are not counted as available. A loan knows exactly which copy was borrowed. |
| Member card | Automatic number (`M00007`) or the number of your existing card; this is what gets scanned at the desk. |
| Book and member pages | Side drawer: copies, their status and who borrowed them, history, returning from the member page, and a "Loan a book to this member" button. |
| Command palette | `Ctrl+K` unified search across books, members, pages and commands. `Ctrl+N` adds a new item on the current page. Works with the Arabic keyboard layout. |
| Arabic search | Normalization: no difference between أ/إ/آ/ا, ى/ي, ة/ه, diacritics and tatweel are ignored, and Arabic-Indic and Latin digits are equivalent. Search by barcode and by ISBN with hyphens. `%` and `_` are treated as ordinary characters. |
| Settings | Library name, default loan period, maximum number of books per member (these were constants in the code). |
| Excel | Export books, members and loans with Arabic headers (right-to-left xlsx). Ready-made templates. Import of xlsx/csv with a preview: new / duplicate / error, with the row number in your file, and an option to add duplicates as extra copies. |

### Added in version 1.3 (phase 3)

| Feature | Details |
|---|---|
| Barcode labels | A4 sheet with 21 labels (63.5×38.1 mm, Avery L7160 size): title, shelf and a Code128 barcode. A "start from slot" option lets you reuse a partly used sheet. The app tracks **unprinted labels**, so after any import you print only the new ones. |
| Member cards | 10 cards per page at bank-card size, with a barcode of the card number. For everyone, or for a single member from their drawer. |
| Loan receipt | 80 mm wide, printed from the loan desk for what the member borrowed in the current session. |
| Overdue list | A printable table: member, phone, book, barcode and days late. |
| Save as PDF | A button next to every print action; it saves what would be printed as a file at the selected page size. |
| Renewal | Adds the default loan period starting from the current due date. Blocked for overdue items, when the limit is reached, and when another member has a reservation. The limit comes from Settings (0 disables it). |
| Fines | Per day late at return time, with an optional cap. Individual or bulk payment, waiving and manual addition (admin only). An option blocks borrowing and renewing once a given amount is reached. |
| Reservations | Accepted only when no copy is available. On return, the copy becomes "ready" for the first person waiting and is withheld from everyone else for a configurable period, then moves to the next person automatically. The desk alerts you: "Set the copy aside". |
| Reminder messages | A ready-made, editable text for overdue items and for ready reservations: copy it (for WhatsApp and text messages) or open it in your mail program. The app does not send anything by itself. |

### Added in version 1.4 (phase 4)

| Feature | Details |
|---|---|
| Reports (admin) | Selectable period (30 days / 90 days / 12 months / all): number of loans and returns, average loan duration, late-return rate, currently overdue, and fines charged, collected and waived. A bar chart for the last 12 months (including zero months), the most borrowed books, members and categories, and "stagnant books" not borrowed in the period. Charts are SVG with no libraries, plus a text table for screen readers. |
| Dark mode | Light / dark / follow system (button at the bottom of the sidebar), and it is remembered. Every color is built as a CSS token with a dark counterpart, and `tests/theme.test.js` checks this along with contrast ratios (WCAG AA) in both modes. |
| Reader mode | A large full-screen search page for members: title, author, shelf and availability only, **with no personal data**. The previous reader's results are cleared after 60 seconds of inactivity. Exiting requires the current user's password (with a lockout after 5 attempts). |
| CI | `.github/workflows/ci.yml`: tests and UI build on every push, and Windows, Linux and macOS installers on a `v*` tag. |

### Added in version 1.5 (security and reliability)

| Feature | Details |
|---|---|
| Audit log | Who did what and when: loans, returns, renewals, archiving, editing books and members, fines, reservations, users, settings, backups, imports, sign-ins, sign-outs and failed sign-in attempts. Arabic search and filtering by user (the "Log" tab, admin only). **Passwords and recovery codes are never logged.** |
| Recovery code | A 20-character code shown once when the administrator account is created, and it cannot be skipped before you confirm you saved it. "Forgot password?" on the sign-in screen sets a new administrator password using this code, then the code is rotated and the old one becomes invalid. Too many wrong attempts lock recovery for 30 seconds. A new code is generated from Administration → Security. |
| Automatic restore on corruption | On every startup the file is checked (`quick_check`). If it is corrupt (after a power cut, for example), it is kept as-is under the name `library.corrupt-<time>.db`, then the latest **healthy** backup is restored (corrupt ones are skipped), and a message explains what happened. If no healthy backup exists, the file is left untouched and the situation is explained. |
| Backup guard | No automatic backup is written from a database that fails the check, so it never replaces a healthy backup. |

### Added in version 1.6 (French)

| Feature | Details |
|---|---|
| Two languages | Arabic (right-to-left) and French (left-to-right). **The language is a library-wide setting** chosen by the administrator in Administration → Settings, and it covers the UI, server messages, the audit log, member reminders, printing, Excel export and its templates. |
| Initial setup | "العربية / Français" buttons on the administrator account creation screen, so the library starts in its language from the very first moment. |
| Direction | Flips automatically: the sidebar, the side drawer, pagination arrows and the monthly chart (time runs in the reading direction). |
| Excel | Headers follow the library language, and **import accepts Arabic and French headers together** regardless of the UI language. |
| Current page | Switching language rebuilds the UI but keeps you on your page. |

#### How to add text or a language
- **The key is the Arabic text itself** (Arabic is the source and has no dictionary). Inside functions: `tr('النص')`, and with variables: `tr('إعارة «{0}» إلى {1}', [title, name])`.
- **File-level constants** (tab lists, labels): `tk('النص')` to mark them, then `tr(variable)` when rendering. Do not use `tr` at file level: it is evaluated once at load time and freezes in its language.
- **Sentences that change with singular/plural or gender** are written with two complete keys instead of assembling fragments (example: `reminderText` in `electron/db.js`).
- `npm run i18n:extract` lists every key. **`tests/i18n.test.js` fails** if Arabic text is left outside `tr()`/`tk()`, a translation is missing, an obsolete key remains, or the number of `{n}` variables does not match. For an intentional exception, put `i18n-ignore` on the text line or the line before it.
- **To add a language** (for example English): create `shared/locales/en.json` with the same keys, add it to `CATALOGS`, `DIR` and `LOCALES` in `src/i18n.js`, and to `CATALOGS` in `electron/i18n.js`. The test automatically covers every file in the folder.

#### Permissions
| | Administrator | Librarian |
|---|---|---|
| Loans and returns | Yes | Yes |
| Add and edit books and members | Yes | Yes |
| Archive and restore | Yes | No |
| Users, backups, settings and import | Yes | No |
| Pay fines, renew, reserve and print | Yes | Yes |
| Waive a fine / add a fine | Yes | No |
| Reports, audit log and recovery code | Yes | No |
| Reader mode (entering) | Yes | Yes |

### Where the data lives
Inside the application data folder (`app.getPath('userData')`):
- `library.db`: the database
- `backups/`: the backups
- Windows: `%APPDATA%/library-manager` · Linux: `~/.config/library-manager` · macOS: `~/Library/Application Support/library-manager`

### Notes
- **Upgrading from version 1.0:** open the app and it upgrades the database automatically after saving a safety backup. Any old duplicate ISBN gets `#dup<number>` appended so it stays visible and you can fix it by hand (nothing is deleted).
- **The recovery code is a master key to the administrator account.** Write it on paper and keep it away from the computer. Whoever has it can reset the administrator password, and whoever loses it along with the password loses access to the data. Accounts created before 1.5 have no code: generate one now from Administration → Security.
- **The audit log is append-only inside the app** (database triggers prevent any edit or deletion). This does not stop someone who has the database file itself from changing it with external tools: it is tracking for mistakes and misuse, not forensic evidence. Restoring a backup returns the log to its state at the time of the backup (and a restore line is added to it).
- **Automatic restore on corruption loses everything after the last backup** (often up to 24 hours), and a message shows the date of the backup used, so review recent loans. The corrupt file stays saved next to the database for inspection.
- **Tests:** `npm test` temporarily rebuilds better-sqlite3 for Node and always switches it back to Electron at the end. If the run is interrupted midway and a `NODE_MODULE_VERSION` error appears on `npm run dev`, run `npx electron-builder install-app-deps`.

- **Upgrading from 1.1:** automatic migration (after a safety backup). For each book, copies are created according to the old `copies` count with the barcode `B<book number>-<n>`, current loans are linked to copies, and every member gets a card number `M<number>`. Old returned loan history stays linked to the book rather than to a copy.
- **The `books.copies` column** is legacy and no longer used; the real count is computed from the `copies` table. Do not rely on it in any new code.
- **The number of copies** cannot be edited from the book form after creation; copies are added and their status changed from the book drawer.
- **Search** uses a normalization function inside SQLite with a full table scan, which is fast up to tens of thousands of records. An FTS5 index is unnecessary at this size and may be added if you go far beyond it.
- **Import:** books without an ISBN are always inserted (duplicates cannot be detected), and duplicate members are detected by normalized name together with phone, or by card number. The limit is 20,000 rows per file.
- **ISBN-10 in Excel** loses its leading zero when saved as a number; the import restores it automatically. It is best to format the column as text (the template is set up that way).

- **Printing:** uses `window.print()` and print CSS (`@page`). **I have not verified it inside a real Electron**; try your first label sheet on plain paper and compare it with the label sheet (you may need to adjust margins in the printer dialog: set them to "no margins / 100%"). If the print dialog does not appear, use "Save as PDF" and then print the file; the PDF path relies on the documented `printToPDF` and respects the page size.
- **Upgrading from 1.2:** automatic migration (after a safety backup). All existing copies are counted as "label not printed" because they were not actually printed, so print them in one batch from "Barcode labels".
- **Reservations and availability:** the "available" count subtracts copies reserved and ready, so it is lower than the number of actually free copies when a reservation exists. Only the member holding the reservation gets that copy. If a reserved copy is damaged, its holder goes back to waiting.
- **Fines:** calculated once at return. Changing the daily fine amount later does not change recorded fines. Amounts are whole numbers in the currency unit (no fractions).
- **Reminder messages** are not sent automatically, and there is no mail or WhatsApp server. Automatic sending needs an account, an external service and keys, and is a separate decision.

- **Contrast audit:** checking both modes revealed that the `brass` and `moss` colors in light mode (from earlier versions) were below the WCAG threshold for normal text, so they were darkened slightly.
- **Reader mode is an application-level lock only**, not isolation at the operating-system level: the staff session stays open behind it, and anyone with access to the computer's desktop can close the app or switch windows. For public machines, use a separate operating-system user account or the system's own kiosk mode.
- **Full screen** in reader mode relies on Electron's `setFullScreen` and I have not actually tried it (the app works without it if it fails).
- **The installer output folder** is now `release/` instead of `dist/`, which the UI build uses; the clash between them would have merged earlier installers into the next package.
- **The installers were not built here.** I cannot download the Electron executable in my environment, so the CI workflow and the `electron-builder` configuration are untested (only the YAML syntax was checked). The first tag you push will be the first real test.
- **Signing:** without a signing certificate you will see SmartScreen (Windows) and Gatekeeper (macOS) warnings. The required secrets are listed in the comments of `ci.yml`.

### Troubleshooting

#### The window is empty or white
1. **Which command did you run?** `npm run dev` for development, and `npm start` for the built files. (Up to version 1.6.0, `npm start` waited for a Vite server that was not running, so the window stayed empty with no message; fixed in 1.6.1.)
2. **Look at the terminal** you ran the command from: UI errors are printed there as `[renderer:error] …` and load failures as `[main] did-fail-load …`.
3. **On the screen itself:** a UI that fails to render now shows why: an explanation page from the main process when loading fails or the UI crashes, a React "error boundary" for an error during rendering, and a "boot guard" that catches a script or CSS load failure or any exception before the UI starts, and warns if nothing is rendered within 8 seconds.
4. **Developer tools** are off by default (they allow running code with the signed-in user's privileges, so they open only on explicit request):
   - `npm start -- --devtools` (or `npm run dev`, then restart Electron with `--devtools`)
   - or the environment variable `ELECTRON_DEVTOOLS=1`
   then F12 or Ctrl+Shift+I.
5. **Send to the developer:** the error text shown on the screen or in the terminal, your operating system, and the command you ran.

#### Other errors
- `NODE_MODULE_VERSION` at startup: run `npx electron-builder install-app-deps` (rebuilds better-sqlite3 for the Electron version). It happens after `npm test` if it was interrupted midway.
- Corrupt database file: it is restored automatically from the latest healthy backup and a message appears (see "Automatic restore on corruption").
- **I have not run the real Electron from my environment.** The tests actually run `main.js` against a mock `electron` (what the window loads, the channels, `preload` in an isolated environment, restore at startup, failure and retry), but a real window was never opened in my tests.

### Not implemented yet

- **Automatic updates** (`electron-updater`): needs a fixed publishing location (GitHub Releases, for example) and a valid signature (macOS refuses unsigned updates). I did not add code that I cannot test here.
- **English in the app:** not added, but adding it is a single dictionary (see "How to add text or a language").
- **More than one machine on the same library:** SQLite is a local file and sharing it over a network is not recommended (it may be corrupted). A central server is needed, which is an architectural change.
- **Sending reminders automatically** (email / WhatsApp / text messages): needs accounts and external services.

#### Translation notes (read before relying on them)
- **The French translation was written by AI and only checked automatically** (variable matching, absence of Arabic letters, coverage of every source key). A native French speaker has not reviewed it, so review the wording, especially in administrative messages and reminder texts. The chosen terms are: *adhérent*, *prêt*, *exemplaire*, *guichet de prêt*, *rayon*. Editing is direct in `shared/locales/fr.json` without touching the keys.
- **The old audit log stays in the language it was recorded in** (rows are stored as text). After switching language you will see older rows in a previous language and newer ones in the current one.
- **Switching language closes open windows** (the UI is rebuilt) and does not keep what was typed in an open form.
- **I have not seen the French UI in a real window.** I tested themes, order and direction (arrow direction, chart column placement, `dir` and `lang`), and with a full sweep that goes through every page, tab and window looking for leaked Arabic letters. I did not visually check fonts (Amiri headings with Latin letters may look different), the wrapping of longer French text inside buttons and tables, or printing on real label paper.
- **What stays Arabic on purpose:** the language name "العربية" in the selection list, a developer message in `preload.js` (an isolated environment that loads no local modules, and users never see it), the text of an SQL trigger, and the letters of the search normalization function.
- **Author names, titles and categories** are user data and are not translated. The only exception is the default category "غير مصنّف" (uncategorized).

### Structure
```
electron/  main.js (window) · handlers.js (IPC, permissions, recovery) · db.js (SQLite and migrations)
           backup.js · recovery.js · excel.js · i18n.js · preload.js
shared/    locales/fr.json  (translation dictionaries, used by the UI and the server)
scripts/   test.js · i18n-extract.cjs · i18n-lib.cjs
public/    boot-guard.js  (boot guard)
src/       ErrorBoundary.jsx · i18n.js · categories.js · App.jsx · Login.jsx · RecoveryCode.jsx · Kiosk.jsx · auth.jsx · settings.jsx · theme.js · ui.jsx · drawers.jsx · printing.jsx
           reminders.jsx · CommandPalette.jsx · hooks.js · text.js · api.js
           pages/ (Dashboard, Desk, Books, Members, Loans, Reports, Admin)
.github/   workflows/ci.yml
tests/     db · features · phase3 · phase4 · phase5 · phase6 · i18n · theme · ipc · main.smoke  (node:test)
           ui/ (app, phase2, phase3, phase4, phase5, fr, guards)  (vitest + jsdom)
```

---

## Français

Application de bureau pour la gestion d'une bibliothèque : Electron + React + Tailwind CSS 4 + Framer Motion + SQLite (better-sqlite3).

### Démarrage

```bash
npm install        # installe les paquets et recompile better-sqlite3 pour Electron automatiquement
npm run dev        # mode développement : lance Vite puis Electron avec --dev (réessaie jusqu'à ce que Vite soit prêt)
npm start          # compile l'interface puis lance Electron sur les fichiers compilés (dist/), sans serveur de développement
npm test           # tous les tests (voir la note ci-dessous)
npm run dist       # crée l'installateur dans le dossier release/
```

Nécessite Node.js 20 ou plus récent.

> **Ne lancez pas `electron .` directement avant `npm run build` :** c'est le « mode production », qui charge `dist/index.html` ; si ce fichier n'existe pas, une page d'explication s'affiche à la place de l'interface. Le mode développement se demande explicitement avec `--dev` (ce que fait `npm run dev` tout seul).

**Premier lancement :** l'écran de création du compte administrateur apparaît. Ensuite, chacun se connecte avec son propre compte.

### Ajouts de la version 1.2 (phase 2)

| Fonctionnalité | Détails |
|---|---|
| Guichet de prêt | Un écran pour la douchette : carte de l'adhérent, puis code-barres de l'exemplaire, puis Entrée ; le prêt est enregistré aussitôt et le curseur revient dans le champ. Mode retour par code-barres, par titre ou par nom d'adhérent. Un journal de session signale les retards. |
| Code-barres par exemplaire | Une table `copies` avec un code-barres unique (`B00012-2`) et un état (bon / abîmé / perdu). Les exemplaires abîmés et perdus ne peuvent pas être prêtés et ne comptent pas comme disponibles. Un prêt sait exactement quel exemplaire a été emprunté. |
| Carte d'adhérent | Numéro automatique (`M00007`) ou numéro de votre carte existante ; c'est ce qui est scanné au guichet. |
| Pages livre et adhérent | Tiroir latéral : exemplaires, leur état et qui les a empruntés, historique, retour depuis la page de l'adhérent, et bouton « Prêter un livre à cet adhérent ». |
| Palette de commandes | `Ctrl+K` : recherche unifiée dans les livres, adhérents, pages et commandes. `Ctrl+N` : ajoute un élément dans la page courante. Fonctionne avec la disposition de clavier arabe. |
| Recherche arabe | Normalisation : aucune différence entre أ/إ/آ/ا, ى/ي, ة/ه, les voyelles brèves et le tatwil sont ignorés, et les chiffres indo-arabes et latins sont équivalents. Recherche par code-barres et par ISBN avec tirets. Les symboles `%` et `_` sont traités comme des caractères ordinaires. |
| Paramètres | Nom de la bibliothèque, durée de prêt par défaut, nombre maximal de livres par adhérent (c'étaient des constantes dans le code). |
| Excel | Export des livres, adhérents et prêts avec des en-têtes arabes (xlsx de droite à gauche). Modèles prêts à l'emploi. Import xlsx/csv avec aperçu : nouveau / doublon / erreur, avec le numéro de ligne dans votre fichier, et une option pour ajouter les doublons comme exemplaires supplémentaires. |

### Ajouts de la version 1.3 (phase 3)

| Fonctionnalité | Détails |
|---|---|
| Étiquettes de code-barres | Feuille A4 de 21 étiquettes (63,5×38,1 mm, format Avery L7160) : titre, rayon et code-barres Code128. L'option « commencer à la case » permet de réutiliser une feuille partiellement utilisée. L'application suit les **étiquettes non imprimées** : après un import, vous n'imprimez que les nouvelles. |
| Cartes d'adhérents | 10 cartes par page au format carte bancaire, avec le code-barres du numéro de carte. Pour tous, ou pour un seul adhérent depuis son tiroir. |
| Reçu de prêt | Largeur 80 mm, imprimé depuis le guichet pour ce que l'adhérent a emprunté pendant la session en cours. |
| Liste des retards | Un tableau à imprimer : adhérent, téléphone, livre, code-barres et jours de retard. |
| Enregistrer en PDF | Un bouton à côté de chaque impression ; il enregistre ce qui serait imprimé dans un fichier au format de page choisi. |
| Prolongation | Ajoute la durée de prêt par défaut à partir de l'échéance actuelle. Interdite pour un prêt en retard, lorsque la limite est atteinte, et lorsqu'un autre adhérent a une réservation. La limite vient des paramètres (0 la désactive). |
| Amendes | Par jour de retard au moment du retour, avec un plafond facultatif. Paiement individuel ou groupé, remise et ajout manuel (administrateur). Une option bloque l'emprunt et la prolongation à partir d'un certain montant. |
| Réservations | Acceptées seulement quand aucun exemplaire n'est disponible. Au retour, l'exemplaire devient « prêt » pour la première personne en attente et est retenu pour les autres pendant un délai réglable, puis passe automatiquement à la suivante. Le guichet vous avertit : « Mettez l'exemplaire de côté ». |
| Messages de rappel | Un texte prêt à l'emploi et modifiable pour les retards et les réservations prêtes : à copier (pour WhatsApp et les SMS) ou à ouvrir dans votre messagerie. L'application n'envoie rien d'elle-même. |

### Ajouts de la version 1.4 (phase 4)

| Fonctionnalité | Détails |
|---|---|
| Rapports (administrateur) | Période au choix (30 jours / 90 jours / 12 mois / tout) : nombre de prêts et de retours, durée moyenne de prêt, taux de retours tardifs, retards en cours, et amendes imposées, encaissées et remises. Un histogramme des 12 derniers mois (mois à zéro inclus), les livres, adhérents et catégories les plus empruntés, et les « livres dormants » non empruntés sur la période. Graphiques en SVG sans bibliothèque, avec un tableau texte pour les lecteurs d'écran. |
| Mode sombre | Clair / sombre / selon le système (bouton en bas de la barre latérale), et le choix est mémorisé. Chaque couleur est construite comme un jeton CSS avec son équivalent sombre, et `tests/theme.test.js` le vérifie ainsi que les rapports de contraste (WCAG AA) dans les deux modes. |
| Mode lecteur | Un grand écran de recherche en plein écran pour les adhérents : titre, auteur, rayon et disponibilité seulement, **sans aucune donnée personnelle**. Les résultats du lecteur précédent sont effacés après 60 secondes d'inactivité. Pour quitter, il faut le mot de passe de l'utilisateur courant (avec verrouillage après 5 tentatives). |
| CI | `.github/workflows/ci.yml` : tests et compilation de l'interface à chaque push, et installateurs Windows, Linux et macOS sur un tag `v*`. |

### Ajouts de la version 1.5 (sécurité et fiabilité)

| Fonctionnalité | Détails |
|---|---|
| Journal des opérations | Qui a fait quoi et quand : prêts, retours, prolongations, archivage, modification des livres et adhérents, amendes, réservations, utilisateurs, paramètres, sauvegardes, imports, connexions, déconnexions et tentatives de connexion échouées. Recherche arabe et filtre par utilisateur (onglet « Journal », administrateur uniquement). **Les mots de passe et les codes de récupération ne sont jamais enregistrés.** |
| Code de récupération | Un code de 20 caractères affiché une seule fois à la création du compte administrateur, impossible à ignorer avant d'avoir confirmé l'avoir noté. « Mot de passe oublié ? » sur l'écran de connexion définit un nouveau mot de passe administrateur avec ce code, puis le code est renouvelé et l'ancien devient invalide. Trop d'essais erronés bloquent la récupération pendant 30 secondes. Un nouveau code se génère depuis Administration → Sécurité. |
| Restauration automatique en cas de corruption | À chaque démarrage, le fichier est vérifié (`quick_check`). S'il est corrompu (après une coupure de courant par exemple), il est conservé tel quel sous le nom `library.corrupt-<heure>.db`, puis la dernière sauvegarde **saine** est restaurée (les sauvegardes corrompues sont ignorées), et un message explique ce qui s'est passé. S'il n'existe aucune sauvegarde saine, le fichier n'est pas touché et la situation est expliquée. |
| Garde de sauvegarde | Aucune sauvegarde automatique n'est écrite à partir d'une base qui échoue à la vérification, pour ne jamais remplacer une sauvegarde saine. |

### Ajouts de la version 1.6 (français)

| Fonctionnalité | Détails |
|---|---|
| Deux langues | Arabe (de droite à gauche) et français (de gauche à droite). **La langue est un réglage valable pour toute la bibliothèque**, choisi par l'administrateur dans Administration → Paramètres, et il couvre l'interface, les messages du serveur, le journal des opérations, les rappels aux adhérents, l'impression, l'export Excel et ses modèles. |
| Configuration initiale | Boutons « العربية / Français » sur l'écran de création du compte administrateur, pour que la bibliothèque démarre dans sa langue dès le premier instant. |
| Direction | S'inverse automatiquement : la barre latérale, le tiroir latéral, les flèches de pagination et le graphique mensuel (le temps suit le sens de lecture). |
| Excel | Les en-têtes suivent la langue de la bibliothèque, et **l'import accepte les en-têtes arabes et français ensemble**, quelle que soit la langue de l'interface. |
| Page courante | Changer de langue reconstruit l'interface mais vous laisse sur votre page. |

#### Comment ajouter des textes ou une langue
- **La clé est le texte arabe lui-même** (l'arabe est la source et n'a pas de dictionnaire). Dans les fonctions : `tr('النص')`, et avec des variables : `tr('إعارة «{0}» إلى {1}', [titre, nom])`.
- **Constantes au niveau du fichier** (listes d'onglets, libellés) : `tk('النص')` pour les marquer, puis `tr(variable)` à l'affichage. N'utilisez pas `tr` au niveau du fichier : il est évalué une seule fois au chargement et reste figé dans sa langue.
- **Les phrases qui changent selon le singulier/pluriel ou le genre** s'écrivent avec deux clés complètes plutôt qu'en assemblant des fragments (exemple : `reminderText` dans `electron/db.js`).
- `npm run i18n:extract` affiche toutes les clés. **`tests/i18n.test.js` échoue** s'il reste du texte arabe hors de `tr()`/`tk()`, s'il manque une traduction, s'il reste une clé obsolète, ou si le nombre de variables `{n}` ne correspond pas. Pour une exception voulue, placez `i18n-ignore` sur la ligne du texte ou la ligne précédente.
- **Pour ajouter une langue** (l'anglais par exemple) : créez `shared/locales/en.json` avec les mêmes clés, ajoutez-la à `CATALOGS`, `DIR` et `LOCALES` dans `src/i18n.js`, et à `CATALOGS` dans `electron/i18n.js`. Le test couvre automatiquement chaque fichier du dossier.

#### Permissions
| | Administrateur | Bibliothécaire |
|---|---|---|
| Prêts et retours | Oui | Oui |
| Ajouter et modifier livres et adhérents | Oui | Oui |
| Archiver et restaurer | Oui | Non |
| Utilisateurs, sauvegardes, paramètres et import | Oui | Non |
| Payer les amendes, prolonger, réserver et imprimer | Oui | Oui |
| Remise d'amende / ajout d'amende | Oui | Non |
| Rapports, journal des opérations et code de récupération | Oui | Non |
| Mode lecteur (y entrer) | Oui | Oui |

### Emplacement des données
Dans le dossier de données de l'application (`app.getPath('userData')`) :
- `library.db` : la base de données
- `backups/` : les sauvegardes
- Windows : `%APPDATA%/library-manager` · Linux : `~/.config/library-manager` · macOS : `~/Library/Application Support/library-manager`

### Notes
- **Mise à jour depuis la version 1.0 :** ouvrez l'application, elle mettra la base à niveau automatiquement après avoir enregistré une sauvegarde de sécurité. Tout ancien ISBN en double se voit ajouter `#dup<numéro>` pour rester visible et que vous le corrigiez à la main (rien n'est supprimé).
- **Le code de récupération est une clé maîtresse du compte administrateur.** Écrivez-le sur papier et gardez-le loin de l'ordinateur. Celui qui le possède peut réinitialiser le mot de passe administrateur, et celui qui le perd avec le mot de passe perd l'accès aux données. Les comptes créés avant la 1.5 n'ont pas de code : générez-en un maintenant depuis Administration → Sécurité.
- **Le journal des opérations est en ajout seul dans l'application** (des déclencheurs dans la base empêchent toute modification ou suppression). Cela n'empêche pas celui qui détient le fichier de base lui-même de le modifier avec des outils externes : c'est un suivi des erreurs et des abus, pas une preuve judiciaire. Restaurer une sauvegarde ramène le journal à son état au moment de la sauvegarde (et une ligne de restauration y est ajoutée).
- **La restauration automatique en cas de corruption perd tout ce qui suit la dernière sauvegarde** (souvent jusqu'à 24 heures), et un message affiche la date de la sauvegarde utilisée ; vérifiez donc les prêts récents. Le fichier corrompu reste conservé à côté de la base pour examen.
- **Tests :** `npm test` recompile temporairement better-sqlite3 pour Node puis le remet toujours pour Electron à la fin. Si l'exécution est interrompue en cours de route et qu'une erreur `NODE_MODULE_VERSION` apparaît avec `npm run dev`, exécutez `npx electron-builder install-app-deps`.

- **Mise à jour depuis la 1.1 :** migration automatique (après une sauvegarde de sécurité). Pour chaque livre, des exemplaires sont créés selon l'ancien nombre `copies` avec le code-barres `B<numéro du livre>-<n>`, les prêts en cours sont reliés à des exemplaires, et chaque adhérent reçoit un numéro de carte `M<numéro>`. L'ancien historique des prêts rendus reste lié au livre et non à un exemplaire.
- **La colonne `books.copies`** est ancienne et n'est plus utilisée ; le nombre réel est calculé depuis la table `copies`. Ne vous y fiez dans aucun nouveau code.
- **Le nombre d'exemplaires** ne se modifie pas depuis le formulaire du livre après sa création ; les exemplaires s'ajoutent et leur état change depuis le tiroir du livre.
- **La recherche** utilise une fonction de normalisation dans SQLite avec un balayage complet de la table, ce qui reste rapide jusqu'à des dizaines de milliers d'enregistrements. Un index FTS5 n'est pas nécessaire à cette taille et pourra être ajouté si vous la dépassez largement.
- **Import :** les livres sans ISBN sont toujours insérés (leurs doublons ne peuvent pas être détectés), et les adhérents en double sont détectés par le nom normalisé avec le téléphone, ou par le numéro de carte. La limite est de 20 000 lignes par fichier.
- **L'ISBN-10 dans Excel** perd son zéro initial quand il est enregistré comme nombre ; l'import le rétablit automatiquement. Le mieux est de formater la colonne en texte (le modèle est prévu ainsi).

- **Impression :** utilise `window.print()` et le CSS d'impression (`@page`). **Je ne l'ai pas vérifiée dans un vrai Electron** ; essayez votre première feuille d'étiquettes sur du papier ordinaire et comparez-la à la planche d'étiquettes (il peut falloir régler les marges dans la boîte de dialogue de l'imprimante : « sans marges / 100 % »). Si la boîte de dialogue d'impression n'apparaît pas, utilisez « Enregistrer en PDF » puis imprimez le fichier ; le chemin PDF s'appuie sur `printToPDF`, documenté, et respecte le format de page.
- **Mise à jour depuis la 1.2 :** migration automatique (après une sauvegarde de sécurité). Tous les exemplaires existants sont comptés comme « étiquette non imprimée », car ils ne l'étaient pas réellement ; imprimez-les en une seule fois depuis « Étiquettes de code-barres ».
- **Réservation et disponibilité :** le nombre de « disponibles » retire les exemplaires réservés et prêts, il est donc inférieur au nombre d'exemplaires réellement libres quand une réservation existe. Seul l'adhérent titulaire de la réservation obtient cet exemplaire. Si un exemplaire réservé est abîmé, son titulaire retourne en attente.
- **Amendes :** calculées une seule fois au retour. Changer ensuite le montant de l'amende journalière ne modifie pas les amendes enregistrées. Les montants sont des entiers dans l'unité monétaire (sans fractions).
- **Les messages de rappel** ne sont pas envoyés automatiquement, et il n'y a ni serveur de messagerie ni serveur WhatsApp. L'envoi automatique demande un compte, un service externe et des clés, et c'est une décision à part.

- **Audit de contraste :** la vérification des deux modes a montré que les couleurs `brass` et `moss` en mode clair (héritées des versions précédentes) étaient sous le seuil WCAG pour le texte normal ; elles ont été légèrement assombries.
- **Le mode lecteur est un verrou au niveau de l'application seulement**, pas une isolation au niveau du système d'exploitation : la session du personnel reste ouverte derrière, et quiconque a accès au bureau de l'ordinateur peut fermer l'application ou changer de fenêtre. Pour des postes publics, utilisez un compte utilisateur système distinct ou le mode kiosque du système lui-même.
- **Le plein écran** du mode lecteur repose sur `setFullScreen` d'Electron et je ne l'ai pas réellement essayé (l'application fonctionne sans lui s'il échoue).
- **Le dossier de sortie des installateurs** est désormais `release/` au lieu de `dist/`, utilisé par la compilation de l'interface ; le conflit entre les deux aurait fusionné d'anciens installateurs dans le paquet suivant.
- **Les installateurs n'ont pas été construits ici.** Je ne peux pas télécharger l'exécutable d'Electron dans mon environnement, donc le workflow CI et la configuration d'`electron-builder` ne sont pas testés (seule la syntaxe YAML a été vérifiée). Le premier tag que vous pousserez sera le premier vrai test.
- **Signature :** sans certificat de signature, vous verrez des avertissements SmartScreen (Windows) et Gatekeeper (macOS). Les secrets nécessaires sont indiqués dans les commentaires de `ci.yml`.

### Dépannage

#### La fenêtre est vide ou blanche
1. **Quelle commande avez-vous lancée ?** `npm run dev` pour le développement, et `npm start` pour les fichiers compilés. (Jusqu'à la version 1.6.0, `npm start` attendait un serveur Vite absent, et la fenêtre restait vide sans message ; corrigé en 1.6.1.)
2. **Regardez le terminal** d'où vous avez lancé la commande : les erreurs de l'interface y sont affichées sous la forme `[renderer:error] …` et les échecs de chargement sous la forme `[main] did-fail-load …`.
3. **À l'écran même :** une interface qui ne s'affiche pas montre désormais pourquoi : une page d'explication du processus principal quand le chargement échoue ou que l'interface plante, une « barrière d'erreur » React en cas d'erreur pendant le rendu, et un « garde de démarrage » qui intercepte l'échec de chargement d'un script ou du CSS ou toute exception avant le démarrage de l'interface, et prévient si rien n'est affiché au bout de 8 secondes.
4. **Les outils de développement** sont fermés par défaut (ils permettent d'exécuter du code avec les droits de l'utilisateur connecté, donc ils ne s'ouvrent que sur demande explicite) :
   - `npm start -- --devtools` (ou `npm run dev`, puis relancez Electron avec `--devtools`)
   - ou la variable d'environnement `ELECTRON_DEVTOOLS=1`
   puis F12 ou Ctrl+Maj+I.
5. **À envoyer au développeur :** le texte de l'erreur affiché à l'écran ou dans le terminal, votre système d'exploitation et la commande lancée.

#### Autres erreurs
- `NODE_MODULE_VERSION` au démarrage : exécutez `npx electron-builder install-app-deps` (recompile better-sqlite3 pour la version d'Electron). Cela arrive après `npm test` s'il a été interrompu en cours de route.
- Fichier de base corrompu : il est restauré automatiquement depuis la dernière sauvegarde saine et un message s'affiche (voir « Restauration automatique en cas de corruption »).
- **Je n'ai pas lancé le vrai Electron depuis mon environnement.** Les tests exécutent réellement `main.js` contre un faux `electron` (ce que la fenêtre charge, les canaux, `preload` en environnement isolé, la restauration au démarrage, l'échec et la nouvelle tentative), mais une vraie fenêtre n'a jamais été ouverte dans mes tests.

### Pas encore implémenté

- **Mises à jour automatiques** (`electron-updater`) : nécessitent un lieu de publication fixe (GitHub Releases par exemple) et une signature valide (macOS refuse une mise à jour non signée). Je n'ai pas ajouté de code que je ne peux pas tester ici.
- **Anglais dans l'application :** non ajouté, mais l'ajouter se résume à un dictionnaire (voir « Comment ajouter des textes ou une langue »).
- **Plusieurs postes sur la même bibliothèque :** SQLite est un fichier local et son partage par le réseau est déconseillé (il peut être corrompu). Il faut un serveur central, ce qui est un changement d'architecture.
- **Envoi automatique des rappels** (e-mail / WhatsApp / SMS) : nécessite des comptes et des services externes.

#### Notes sur la traduction (à lire avant de s'y fier)
- **La traduction française a été écrite par une IA et vérifiée seulement automatiquement** (concordance des variables, absence de lettres arabes, couverture de toutes les clés sources). Aucun francophone natif ne l'a relue ; vérifiez donc la formulation, surtout dans les messages administratifs et les textes de rappel. Les termes retenus sont : *adhérent*, *prêt*, *exemplaire*, *guichet de prêt*, *rayon*. La modification se fait directement dans `shared/locales/fr.json` sans toucher aux clés.
- **L'ancien journal des opérations reste dans la langue où il a été enregistré** (les lignes sont stockées en texte). Après un changement de langue, vous verrez des lignes anciennes dans une langue précédente et des lignes récentes dans la langue actuelle.
- **Changer de langue ferme les fenêtres ouvertes** (l'interface est reconstruite) et ne conserve pas ce qui a été saisi dans un formulaire ouvert.
- **Je n'ai pas vu l'interface française dans une vraie fenêtre.** J'ai testé les thèmes, l'ordre et la direction (sens des flèches, position des colonnes du graphique, `dir` et `lang`), ainsi qu'un balayage complet qui parcourt chaque page, onglet et fenêtre à la recherche de lettres arabes qui auraient fui. Je n'ai pas vérifié visuellement les polices (les titres Amiri en lettres latines peuvent paraître différents), le retour à la ligne des textes français plus longs dans les boutons et les tableaux, ni l'impression sur de vrais papiers d'étiquettes.
- **Ce qui reste en arabe volontairement :** le nom de la langue « العربية » dans la liste de choix, un message de développeur dans `preload.js` (environnement isolé qui ne charge aucun module local, et que l'utilisateur ne voit jamais), le texte d'un déclencheur SQL, et les lettres de la fonction de normalisation de la recherche.
- **Les noms d'auteurs, les titres et les catégories** sont des données de l'utilisateur et ne sont pas traduits. La seule exception est la catégorie par défaut « غير مصنّف » (non classé).

### Structure
```
electron/  main.js (fenêtre) · handlers.js (IPC, permissions, récupération) · db.js (SQLite et migrations)
           backup.js · recovery.js · excel.js · i18n.js · preload.js
shared/    locales/fr.json  (dictionnaires de traduction, utilisés par l'interface et le serveur)
scripts/   test.js · i18n-extract.cjs · i18n-lib.cjs
public/    boot-guard.js  (garde de démarrage)
src/       ErrorBoundary.jsx · i18n.js · categories.js · App.jsx · Login.jsx · RecoveryCode.jsx · Kiosk.jsx · auth.jsx · settings.jsx · theme.js · ui.jsx · drawers.jsx · printing.jsx
           reminders.jsx · CommandPalette.jsx · hooks.js · text.js · api.js
           pages/ (Dashboard, Desk, Books, Members, Loans, Reports, Admin)
.github/   workflows/ci.yml
tests/     db · features · phase3 · phase4 · phase5 · phase6 · i18n · theme · ipc · main.smoke  (node:test)
           ui/ (app, phase2, phase3, phase4, phase5, fr, guards)  (vitest + jsdom)
```

---

## العربية

<div dir="rtl">

تطبيق سطح مكتب لإدارة المكتبة: Electron + React + Tailwind CSS 4 + Framer Motion + SQLite (better-sqlite3).

### التشغيل

```bash
npm install        # يثبّت الحزم ويبني better-sqlite3 لإصدار Electron تلقائيًا
npm run dev        # وضع التطوير: يشغّل Vite ثم Electron بالراية --dev (يعيد المحاولة حتى يجهز Vite)
npm start          # يبني الواجهة ثم يشغّل Electron على الملفات المبنية (dist/)، بلا خادم تطوير
npm test           # كل الاختبارات (انظر الملاحظة أدناه)
npm run dist       # إنشاء ملف التثبيت في مجلد release/
```

يتطلب Node.js 20 أو أحدث.

> **لا تشغّل `electron .` مباشرة قبل `npm run build`:** هذا «وضع الإنتاج» ويحمّل `dist/index.html`، فإن لم يوجد ظهرت صفحة شرح بدل الواجهة. وضع التطوير يُطلب صراحة بـ `--dev` (يفعله `npm run dev` وحده).

**أول تشغيل:** تظهر شاشة إنشاء حساب المدير. بعدها يدخل الجميع بحساباتهم.

### ما أُضيف في الإصدار 1.2 (المرحلة الثانية)

| الميزة | التفاصيل |
|---|---|
| مكتب الإعارة | شاشة للمسح بالقارئ: بطاقة العضو ثم باركود النسخة ثم Enter، فتُسجَّل الإعارة فورًا ويعود المؤشر للحقل. وضع إرجاع بالباركود أو بالعنوان أو اسم العضو. سجل للجلسة ينبّه إلى التأخير. |
| باركود لكل نسخة | جدول `copies` بباركود فريد (`B00012-2`) وحالة (سليمة / تالفة / مفقودة). التالفة والمفقودة لا تُعار ولا تُحسب متاحة. الإعارة تعرف أي نسخة بالتحديد. |
| بطاقة العضو | رقم تلقائي (`M00007`) أو رقم بطاقتك الحالية، وهو ما يُمسح في المكتب. |
| صفحتا الكتاب والعضو | درج جانبي: النسخ وحالتها ومن استعارها، السجل، الإرجاع من صفحة العضو، وزر «إعارة كتاب لهذا العضو». |
| شريط الأوامر | `Ctrl+K` بحث موحّد في الكتب والأعضاء والصفحات والأوامر. `Ctrl+N` إضافة جديد في الصفحة الحالية. تعمل مع التخطيط العربي. |
| البحث العربي | تطبيع: لا فرق بين أ/إ/آ/ا، ى/ي، ة/ه، ولا التشكيل والتطويل، والأرقام الهندية واللاتينية. البحث بالباركود وISBN بشرطات. الرمزان `%` و`_` يُعاملان كحرفين عاديين. |
| الإعدادات | اسم المكتبة، مدة الإعارة الافتراضية، الحد الأقصى للكتب للعضو (كانت ثوابت في الكود). |
| Excel | تصدير الكتب والأعضاء والإعارات بعناوين عربية (xlsx من اليمين لليسار). قوالب جاهزة. استيراد xlsx/csv بمعاينة: جديد / مكرر / خطأ مع رقم الصف في ملفك، وخيار لإضافة المكرر كنسخ. |

### ما أُضيف في الإصدار 1.3 (المرحلة الثالثة)

| الميزة | التفاصيل |
|---|---|
| ملصقات الباركود | A4 بـ 21 ملصقًا (63.5×38.1 مم، مقاس Avery L7160): العنوان والرفّ وباركود Code128. خيار «ابدأ من الخانة» لاستعمال ورقة مستعملة جزئيًا. التطبيق يتتبع **الملصقات غير المطبوعة** فتطبع الجديد فقط بعد أي استيراد. |
| بطاقات الأعضاء | 10 بطاقات في الصفحة بحجم بطاقة بنكية، بباركود رقم البطاقة. للجميع أو لعضو واحد من درجه. |
| إيصال الإعارة | بعرض 80 مم، من مكتب الإعارة لما أُعير للعضو في الجلسة الحالية. |
| كشف المتأخرات | جدول للطباعة: العضو والهاتف والكتاب والباركود وأيام التأخير. |
| حفظ PDF | زر بجانب كل طباعة، يحفظ ما سيُطبع كملف بحجم الصفحة المحدد. |
| التمديد | يضيف مدة الإعارة الافتراضية من الموعد الحالي. يُمنع للمتأخرة، وعند بلوغ الحد، وعند وجود حجز من عضو آخر. الحد من الإعدادات (0 يعطّله). |
| الغرامات | عن كل يوم تأخير عند الإرجاع، مع سقف اختياري. تسديد فردي أو كلي، وإعفاء وإضافة يدوية (للمدير). خيار لمنع الاستعارة والتمديد عند بلوغ مبلغ معيّن. |
| الحجوزات | تُقبل فقط حين لا توجد نسخة متاحة. عند الإرجاع تصبح النسخة «جاهزة» لأول المنتظرين وتُحجب عن غيره طوال مهلة قابلة للضبط، ثم تنتقل للتالي تلقائيًا. المكتب ينبّهك: «ضع النسخة جانبًا». |
| رسائل التذكير | نص جاهز قابل للتعديل للمتأخرات وللحجز الجاهز: يُنسخ (للواتساب والرسائل) أو يُفتح في برنامج البريد. التطبيق لا يرسل شيئًا بنفسه. |

### ما أُضيف في الإصدار 1.4 (المرحلة الرابعة)

| الميزة | التفاصيل |
|---|---|
| التقارير (للمدير) | فترة قابلة للاختيار (30 / 90 يومًا / 12 شهرًا / الكل): عدد الإعارات والإرجاعات، متوسط مدة الإعارة، نسبة الإرجاع المتأخر، المتأخر الآن، والغرامات المفروضة والمحصّلة والمعفاة. رسم أعمدة لآخر 12 شهرًا (مع الأشهر الصفرية)، وأكثر الكتب والأعضاء والتصنيفات استعارة، و«كتب راكدة» لم تُستعر في الفترة. الرسوم SVG بلا مكتبات، مع جدول نصي لقارئات الشاشة. |
| الوضع الداكن | فاتح / داكن / حسب النظام (زر في أسفل الشريط الجانبي) ويُحفظ. كل لون بُني كرمز CSS له نظير داكن، ويفحص `tests/theme.test.js` ذلك ونسب التباين (WCAG AA) في الوضعين. |
| وضع القارئ | شاشة بحث كبيرة للأعضاء على كامل الشاشة: العنوان والمؤلف والرفّ والتوفر فقط، **بلا أي بيانات شخصية**. تُفرَّغ نتائج القارئ السابق بعد 60 ثانية خمول. الخروج يتطلب كلمة مرور المستخدم الحالي (مع قفل بعد 5 محاولات). |
| CI | `.github/workflows/ci.yml`: اختبارات وبناء الواجهة عند كل دفع، وبناء مثبّتات ويندوز ولينكس وماك عند وسم `v*`. |

### ما أُضيف في الإصدار 1.5 (الأمان والموثوقية)

| الميزة | التفاصيل |
|---|---|
| سجل العمليات | من فعل ماذا ومتى: الإعارة والإرجاع والتمديد والأرشفة وتعديل الكتب والأعضاء والغرامات والحجوزات والمستخدمين والإعدادات والنسخ والاستيراد، والدخول والخروج ومحاولات الدخول الفاشلة. بحث عربي وتصفية بالمستخدم (تبويب «السجل» للمدير). **لا تُسجَّل كلمات المرور ولا رموز الاسترداد.** |
| رمز الاسترداد | رمز من 20 حرفًا يُعرض مرة واحدة عند إنشاء حساب المدير ولا يُتجاوز قبل تأكيد حفظه. «نسيت كلمة المرور؟» في شاشة الدخول تعيّن كلمة مرور جديدة للمدير بهذا الرمز، ثم يُدوَّر الرمز فيبطل القديم. محاولات خاطئة كثيرة تقفل الاسترداد 30 ثانية. يُنشأ رمز جديد من الإدارة ← الأمان. |
| استرجاع تلقائي عند تلف الملف | عند كل تشغيل يُفحص الملف (`quick_check`). إن كان تالفًا (انقطاع كهرباء مثلًا) يُحفظ كما هو باسم `library.corrupt-<وقت>.db` ثم تُسترجع أحدث نسخة احتياطية **سليمة** (تُتخطى التالفة)، وتظهر رسالة بما حدث. إن لم توجد نسخة سليمة لا يُمسّ الملف ويُشرح الموقف. |
| حارس النسخ الاحتياطي | لا تُكتب نسخة تلقائية من قاعدة فاشلة في الفحص، حتى لا تحلّ محل نسخة سليمة. |

### ما أُضيف في الإصدار 1.6 (الفرنسية)

| الميزة | التفاصيل |
|---|---|
| لغتان | العربية (من اليمين لليسار) والفرنسية (من اليسار لليمين). **اللغة إعداد للمكتبة كلها** يحدده المدير من الإدارة ← الإعدادات، ويشمل الواجهة ورسائل الخادم وسجل العمليات وتذكيرات الأعضاء والطباعة وتصدير Excel وقوالبه. |
| الإعداد الأول | زرّا «العربية / Français» في شاشة إنشاء حساب المدير، فتبدأ المكتبة بلغتها من أول لحظة. |
| الاتجاه | ينعكس تلقائيًا: القائمة الجانبية، الدرج الجانبي، أسهم الترقيم، والرسم الشهري (الزمن يسير مع اتجاه القراءة). |
| Excel | العناوين تتبع لغة المكتبة، **والاستيراد يقبل العناوين بالعربية والفرنسية معًا** بغض النظر عن لغة الواجهة. |
| الصفحة الحالية | تبديل اللغة يعيد بناء الواجهة لكنه يُبقيك في صفحتك. |

#### كيف تُضاف نصوص أو لغة
- **المفتاح هو النص العربي نفسه** (العربية هي الأصل ولا قاموس لها). داخل الدوال: `tr('نص')`، ومع متغيرات: `tr('إعارة «{0}» إلى {1}', [عنوان, اسم])`.
- **ثوابت على مستوى الملف** (قوائم تبويبات، تسميات): `tk('نص')` للتعليم، ثم `tr(المتغير)` عند العرض. لا تستعمل `tr` على مستوى الملف: تُقيَّم مرة عند التحميل فتتجمّد بلغتها.
- **الجمل التي تتغير بالمفرد والجمع أو الجنس** تُكتب بمفتاحين كاملين لا بتركيب أجزاء (مثال: `reminderText` في `electron/db.js`).
- `npm run i18n:extract` يعرض كل المفاتيح. **`tests/i18n.test.js` يفشل** إن بقي نص عربي خارج `tr()`/`tk()`، أو نقصت ترجمة، أو بقي مفتاح مهجور، أو اختل عدد المتغيرات `{n}`. للاستثناء المقصود ضع `i18n-ignore` في سطر النص أو السطر السابق.
- **لإضافة لغة** (مثل الإنجليزية): أنشئ `shared/locales/en.json` بالمفاتيح نفسها، وأضفها إلى `CATALOGS` و`DIR` و`LOCALES` في `src/i18n.js`، وإلى `CATALOGS` في `electron/i18n.js`. الاختبار يمرّ على كل ملف في المجلد تلقائيًا.

#### الصلاحيات
| | مدير | أمين مكتبة |
|---|---|---|
| إعارة وإرجاع | نعم | نعم |
| إضافة وتعديل كتب وأعضاء | نعم | نعم |
| أرشفة واسترجاع | نعم | لا |
| المستخدمون والنسخ الاحتياطي والإعدادات والاستيراد | نعم | لا |
| تسديد الغرامات والتمديد والحجز والطباعة | نعم | نعم |
| إعفاء من غرامة / إضافة غرامة | نعم | لا |
| التقارير وسجل العمليات ورمز الاسترداد | نعم | لا |
| وضع القارئ (الدخول) | نعم | نعم |

### مكان البيانات
داخل مجلد بيانات التطبيق (`app.getPath('userData')`):
- `library.db`: قاعدة البيانات
- `backups/`: النسخ الاحتياطية
- Windows: `%APPDATA%/library-manager` · Linux: `~/.config/library-manager` · macOS: `~/Library/Application Support/library-manager`

### ملاحظات
- **التحديث من الإصدار 1.0:** افتح التطبيق وسيرقّي القاعدة تلقائيًا بعد حفظ نسخة أمان. أي ISBN مكرر قديم يُلحَق به `#dup<رقم>` ليبقى ظاهرًا وتصحّحه يدويًا (لا يُحذف شيء).
- **رمز الاسترداد مفتاح كامل للمدير.** اكتبه على ورقة واحفظها بعيدًا عن الحاسوب. من يملكه يعيد تعيين كلمة مرور المدير، ومن يفقده مع كلمة المرور يفقد الوصول إلى البيانات. الحسابات المُنشأة قبل 1.5 بلا رمز: أنشئ واحدًا الآن من الإدارة ← الأمان.
- **سجل العمليات للإلحاق فقط داخل التطبيق** (مشغّلات في القاعدة تمنع أي تعديل أو حذف). هذا لا يمنع من يملك ملف القاعدة نفسه من تغييره بأدوات خارجية، فهو تتبّع للأخطاء وسوء الاستعمال لا دليل جنائي. واسترجاع نسخة احتياطية يعيد السجل إلى حالته وقت النسخة (ويُضاف إليه سطر الاسترجاع).
- **الاسترجاع التلقائي عند التلف يفقد ما بعد آخر نسخة** (حتى 24 ساعة غالبًا)، وتُعرض رسالة بتاريخ النسخة المستعملة، فراجع الإعارات الأخيرة. الملف التالف يبقى محفوظًا بجانب القاعدة للفحص.
- **الاختبارات:** `npm test` يعيد بناء better-sqlite3 لـ Node مؤقتًا ثم يعيده لـ Electron في النهاية دائمًا. إن انقطع التشغيل في المنتصف وظهر خطأ `NODE_MODULE_VERSION` عند `npm run dev` فنفّذ `npx electron-builder install-app-deps`.

- **التحديث من 1.1:** ترحيل تلقائي (بعد نسخة أمان). لكل كتاب تُنشأ نسخ بعدد `copies` القديم بباركود `B<رقم الكتاب>-<ن>`، وتُربط الإعارات الجارية بنسخ، ويأخذ كل عضو رقم بطاقة `M<رقم>`. سجل الإعارات القديم المُعاد يبقى مرتبطًا بالكتاب لا بنسخة.
- **العمود `books.copies`** قديم ولا يُستعمل بعد الآن؛ العدد الحقيقي يُحسب من جدول `copies`. لا تعتمد عليه في أي كود جديد.
- **عدد النسخ** لا يُعدَّل من نموذج الكتاب بعد إنشائه؛ تُضاف النسخ وتُغيَّر حالتها من درج الكتاب.
- **البحث** يستعمل دالة تطبيع داخل SQLite مع مسح كامل للجدول، وهو سريع حتى عشرات الآلاف من السجلات. فهرس FTS5 غير ضروري عند هذا الحجم، وقد يُضاف لو تجاوزتَه كثيرًا.
- **الاستيراد:** الكتب بلا ISBN تُدخل دائمًا (لا يمكن كشف تكرارها)، والأعضاء المكررون يُكتشفون بالاسم المطبَّع مع الهاتف أو برقم البطاقة. الحد 20000 صف للملف.
- **ISBN-10 في Excel** يفقد الصفر الأول عند حفظه كرقم؛ يعيده الاستيراد تلقائيًا. الأفضل تنسيق العمود كنص (القالب مُعدّ لذلك).

- **الطباعة:** تستعمل `window.print()` وCSS الطباعة (`@page`). **لم أتحقق منها داخل Electron حقيقي**؛ جرّب أول ورقة ملصقات على ورق عادي وقارنها بورقة الملصقات (قد تحتاج ضبط الهوامش من حوار الطابعة: اجعلها «بلا هوامش/100%»). إن لم يظهر حوار الطباعة فاستعمل «حفظ PDF» ثم اطبع الملف، فمسار PDF يعتمد على `printToPDF` الموثّق ويحترم حجم الصفحة.
- **التحديث من 1.2:** ترحيل تلقائي (بعد نسخة أمان). كل النسخ الحالية تُعدّ «غير مطبوعة الملصق» لأنها لم تكن مطبوعة فعلًا، فاطبعها دفعة واحدة من «ملصقات الباركود».
- **الحجز والمتاح:** عدد «المتاح» يطرح النسخ المحجوزة الجاهزة، فيقلّ عن النسخ الحرة فعليًا حين يكون هناك حجز. العضو صاحب الحجز وحده يأخذ تلك النسخة. إن تلفت نسخة محجوزة يعود صاحبها إلى الانتظار.
- **الغرامات:** تُحسب مرة واحدة عند الإرجاع. تغيير قيمة الغرامة اليومية لاحقًا لا يغيّر الغرامات المسجّلة. المبالغ أعداد صحيحة بوحدة العملة (بلا كسور).
- **رسائل التذكير** لا تُرسل آليًا ولا يوجد خادم بريد أو واتساب. الإرسال الآلي يحتاج حسابًا وخدمة خارجية ومفاتيح، وهو قرار منفصل.

- **تدقيق التباين:** فحص الوضعين كشف أن لون `brass` و`moss` في الوضع الفاتح (من الإصدارات السابقة) كان دون حد WCAG للنص العادي، فأُغمقا قليلًا.
- **وضع القارئ قفل على مستوى التطبيق فقط**، لا عزل على مستوى نظام التشغيل: جلسة الموظف تبقى مفتوحة خلفه، ومن يملك وصولًا لسطح مكتب الحاسوب يستطيع إغلاق التطبيق أو التنقل بين النوافذ. للأجهزة العامة استعمل حساب مستخدم منفصل في النظام أو وضع kiosk للنظام نفسه.
- **ملء الشاشة** في وضع القارئ يعتمد على `setFullScreen` في Electron ولم أجرّبه فعليًا (يعمل التطبيق دونه إن فشل).
- **مجلد مخرجات المثبّتات** صار `release/` بدل `dist/` الذي يستعمله بناء الواجهة؛ كان التعارض بينهما سيدمج مثبّتات سابقة في الحزمة التالية.
- **المثبّتات لم تُبنَ هنا.** لا أستطيع تنزيل ملف Electron التنفيذي في بيئتي، فسير عمل CI وإعداد `electron-builder` غير مجرَّبين (صحة صيغة YAML فقط فُحصت). أول وسم ستدفعه هو أول تجربة حقيقية.
- **التوقيع:** بدون شهادة توقيع تظهر تحذيرات SmartScreen (ويندوز) وGatekeeper (ماك). الأسرار المطلوبة مذكورة في تعليقات `ci.yml`.

### استكشاف الأخطاء

#### النافذة فارغة أو بيضاء
1. **أي أمر شغّلتَ؟** `npm run dev` للتطوير، و`npm start` للملفات المبنية. (كان `npm start` في الإصدارات حتى 1.6.0 يطلب خادم Vite غير الموجود فتبقى النافذة فارغة بلا رسالة، وأُصلح في 1.6.1.)
2. **انظر الطرفية** التي شغّلت منها الأمر: تُطبع هناك أخطاء الواجهة بصيغة `[renderer:error] …` وفشل التحميل `[main] did-fail-load …`.
3. **على الشاشة نفسها:** صارت الواجهة التي لا تُرسم تُظهر سببها: صفحة شرح من العملية الرئيسية عند فشل التحميل أو انهيار الواجهة، و«حدّ أخطاء» React عند خطأ أثناء الرسم، و«حارس إقلاع» يلتقط فشل تحميل السكربت أو CSS أو أي استثناء قبل بدء الواجهة، وينبّه إن لم يُرسم شيء خلال 8 ثوانٍ.
4. **أدوات المطوّر** مغلقة افتراضيًا (تسمح بتنفيذ شيفرة بصلاحيات المستخدم المسجَّل، فلا تُفتح إلا بطلب صريح):
   - `npm start -- --devtools` (أو `npm run dev` ثم أعد تشغيل Electron بـ `--devtools`)
   - أو متغير البيئة `ELECTRON_DEVTOOLS=1`
   ثم F12 أو Ctrl+Shift+I.
5. **أرسل للمطوّر:** نص الخطأ الظاهر على الشاشة أو في الطرفية، ونظام التشغيل، والأمر الذي شغّلتَه.

#### أخطاء أخرى
- `NODE_MODULE_VERSION` عند التشغيل: نفّذ `npx electron-builder install-app-deps` (يعيد بناء better-sqlite3 لإصدار Electron). يحدث بعد `npm test` إن انقطع في المنتصف.
- ملف القاعدة تالف: يُسترجع تلقائيًا من أحدث نسخة سليمة وتظهر رسالة (انظر «الاسترجاع التلقائي عند تلف الملف»).
- **لم أشغّل Electron الحقيقي من بيئتي.** الاختبارات تشغّل `main.js` فعلًا ضد نسخة وهمية من `electron` (ما تحمّله النافذة، القنوات، `preload` في بيئة معزولة، الاسترجاع عند الإقلاع، الفشل وإعادة المحاولة)، لكن نافذة حقيقية لم تُفتح قط في اختباراتي.

### ما لم يُنفَّذ بعد

- **التحديث التلقائي** (`electron-updater`): يحتاج مكان نشر ثابتًا (GitHub Releases مثلًا) وتوقيعًا صالحًا (ماك يرفض التحديث غير الموقّع). لم أضف شيفرة لا أستطيع اختبارها هنا.
- **الإنجليزية:** غير مضافة، لكن إضافتها قاموس واحد (انظر «كيف تُضاف نصوص أو لغة»).
- **أكثر من جهاز على المكتبة نفسها:** SQLite ملف محلي، ولا يُنصح بمشاركته عبر الشبكة (قد يفسد). يلزم خادم مركزي وهو تغيير معماري.
- **إرسال التذكيرات آليًا** (بريد/واتساب/رسائل نصية): يحتاج حسابات وخدمات خارجية.

#### ملاحظات الترجمة (اقرأها قبل الاعتماد)
- **الترجمة الفرنسية كتبها الذكاء الاصطناعي وراجعتها آليًا فقط** (تطابق المتغيرات، وغياب الحروف العربية، وتغطية كل المصدر). لم يراجعها متحدث فرنسي أصلي، فراجع الصياغة خاصة في الرسائل الإدارية ونصوص التذكير. المصطلحات المختارة: *adhérent*، *prêt*، *exemplaire*، *guichet de prêt*، *rayon*. التعديل مباشر في `shared/locales/fr.json` دون المساس بالمفاتيح.
- **سجل العمليات القديم يبقى باللغة التي سُجِّل بها** (الصفوف تُخزَّن نصًّا). بعد تبديل اللغة ترى صفوفًا قديمة بلغة سابقة وجديدة بالحالية.
- **تبديل اللغة يغلق النوافذ المفتوحة** (تُعاد بناء الواجهة)، ولا يحتفظ بما كُتب في نموذج مفتوح.
- **لم أر الواجهة الفرنسية في نافذة حقيقية.** اختبرتُ بالسمات والترتيب والاتجاه (اتجاه الأسهم، موضع أعمدة الرسم، `dir` و`lang`) وبمسح شامل يمرّ على كل صفحة وتبويب ونافذة بحثًا عن حروف عربية متسرّبة. لم أفحص بصريًا الخطوط (عناوين Amiri بحروف لاتينية قد تبدو مختلفة)، ولا التفاف النصوص الفرنسية الأطول داخل الأزرار والجداول، ولا الطباعة على ورق ملصقات حقيقي.
- **ما يبقى عربيًا عن قصد:** اسم اللغة «العربية» في قائمة الاختيار، ورسالة مطوّر في `preload.js` (بيئة معزولة لا تحمّل وحدات محلية، ولا يراها المستخدم)، ونص مشغّل SQL، وحروف دالة تطبيع البحث.
- **أسماء المؤلفين والعناوين والتصنيفات** بيانات المستخدم لا تُترجم. الاستثناء الوحيد التصنيف الافتراضي «غير مصنّف».

### البنية
```
electron/  main.js (النافذة) · handlers.js (IPC والصلاحيات والاسترجاع) · db.js (SQLite والترحيلات)
           backup.js · recovery.js · excel.js · i18n.js · preload.js
shared/    locales/fr.json  (قواميس الترجمة، تُستعمل في الواجهة والخادم)
scripts/   test.js · i18n-extract.cjs · i18n-lib.cjs
public/    boot-guard.js  (حارس الإقلاع)
src/       ErrorBoundary.jsx · i18n.js · categories.js · App.jsx · Login.jsx · RecoveryCode.jsx · Kiosk.jsx · auth.jsx · settings.jsx · theme.js · ui.jsx · drawers.jsx · printing.jsx
           reminders.jsx · CommandPalette.jsx · hooks.js · text.js · api.js
           pages/ (Dashboard, Desk, Books, Members, Loans, Reports, Admin)
.github/   workflows/ci.yml
tests/     db · features · phase3 · phase4 · phase5 · phase6 · i18n · theme · ipc · main.smoke  (node:test)
           ui/ (app, phase2, phase3, phase4, phase5, fr, guards)  (vitest + jsdom)
```

</div>
