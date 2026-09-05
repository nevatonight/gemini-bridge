# Gemini Bridge 0.4.8.8 — Complete Project Documentation

> This document is the single detailed technical and operational reference for the Gemini Bridge 0.4.8.8 release tree. `README.md` is intentionally shorter. When implementation and documentation disagree, the physically shipped code and release tests are authoritative; update this document as part of the same change before release.

## 1. Product purpose

Gemini Bridge is a local Windows companion that lets a user work with **Google Antigravity CLI alongside ChatGPT** without pretending that Gemini is an OpenAI-hosted model or giving Gemini direct control over ChatGPT.

It is designed around four practical user jobs:

1. **Ask Gemini** while staying in the user's normal ChatGPT workflow.
2. **Review a local project** with Gemini without giving it the live working directory directly.
3. **Let Gemini edit a project safely** by editing an isolated snapshot first, showing a Preview, and requiring an explicit Apply before live files change.
4. **Recover predictably after failures** such as a browser refresh, Host restart, cancelled Gemini run, external file edit, interrupted Apply, failed upgrade, or broken runtime.

The product is deliberately local-first. The Bridge Host, SQLite history, snapshots, pairing token, managed Antigravity CLI runtime and isolated Antigravity settings profile are stored on the user's computer. Gemini requests leave the computer through the verified managed Antigravity CLI. ChatGPT and OpenAI credentials are not used by the Bridge.

## 2. What Gemini Bridge is not

Gemini Bridge is **not**:

- an OpenAI model selector;
- a replacement for ChatGPT's native composer;
- a scraper for hidden ChatGPT Project Memory;
- an OpenAI private-API client;
- a browser automation tool that sends ChatGPT messages for the user;
- a shell agent with unrestricted access to the user's computer;
- a Git worktree/check-out manager;
- an automatic source-control commit tool;
- an automatic uploader of the user's entire workspace.

The optional browser extension adds a separate Gemini panel to `chatgpt.com`. It does not read ChatGPT cookies, session tokens or private APIs and does not intercept the native ChatGPT composer.

## 2.1 0.4.8.8 compatibility/hotfix scope


### 2.1.1 0.4.8.6 real-Windows managed-runtime failure and 0.4.8.8 fix

The 0.4.8.6 Windows setup log proved a PowerShell scope bug rather than an Antigravity binary failure. `$Source` represented the release directory at script scope while `Ensure-Antigravity` introduced local `$source` for `%LOCALAPPDATA%\agy\bin\agy.exe`. PowerShell variable names are case-insensitive and nested functions can resolve variables through dynamic scope, so `Invoke-AntigravityEntryProbe` constructed the helper path beneath the executable: `...\agy.exe\src\managed-antigravity-probe.mjs`. 0.4.8.8 removes the ambiguous name entirely. The immutable release directory is `$script:ReleaseRoot`; the external binary is `$externalEntry`; copy helpers use `$sourceFile`. Regression Phase AI scans these contracts and guards critical script-owned roots against local shadowing.

Because Antigravity can self-update independently, external discovery is not trusted as the runtime itself. The candidate is probed, copied into a fresh app-owned versioned directory, and the managed copy is probed against the exact source version. Candidate probing and source-copy verification use bounded retries so a transient updater/Defender lock or source-version change cannot silently produce a mismatched managed runtime. Failure removes only the newly created managed candidate and leaves the user-local Antigravity installation untouched.

The 0.4.8.8 hotfix was triggered by a real upgrade from an older installed runtime. Because Windows Setup uses PowerShell StrictMode, legacy JSON must not be dereferenced as if all newer Antigravity fields already exist. Setup now uses guarded optional-property reads for migration metadata and legacy Host locks, including rollback paths; Uninstall applies the same rule before ownership comparison. Missing ownership data still causes a deliberate fail-closed refusal where identity is security-relevant.

The application-version parser accepts both historical `x.y.z` and current `x.y.z.w` numeric forms using `System.Version`, while malformed, missing or downgrade versions are refused before destructive staging.

The provider-mode contract is also frozen by tests: **Ask uses Antigravity `default`**, **Review uses `plan`**, and **Agent Edit uses `accept-edits` only against the sanitized snapshot**. The canonical suite includes a dedicated **70-case high-risk audit** for the most likely setup/runtime/auth/safety/package failures around this migration, backed by a ranked Top-100 risk register in `RISK_AUDIT_TOP100.md`.

## 3. Supported release contract

### Operating system

The installer, launcher, repair/update and uninstall workflow targets **Windows 10/11**.

Automated release tests also execute the platform-independent Node.js core on Linux. Linux execution is a test environment, not the supported end-user installer target.

### Node.js

0.4.6 intentionally accepts only bounded target major lines instead of promising compatibility with arbitrary future Node releases:

- Node.js **22.13 or newer within 22.x**;
- Node.js **24.x**.

The automated Linux release environment currently exercises Node 22.x. Node 24.x is accepted by the installer contract because it is the target machine line, but the exact target Windows Node 24 runtime remains an explicit real-environment acceptance gate rather than an inferred PASS.

`Setup.ps1` rejects future unvalidated major versions. `package.json` expresses the same contract as:

`>=22.13 <23 || >=24 <25`

If a supported Node is unavailable, Setup can attempt installation through Windows Package Manager (`winget`). Node remains a system prerequisite; Gemini Bridge does not bundle its own Node executable.

### Antigravity CLI

The release uses **Google Antigravity CLI 1.1.20 or newer**. Setup discovers an existing user-local `agy` or, when absent, invokes Google's official Windows installer with profile/PATH mutation disabled. It then probes the real version and copies that exact executable into a versioned Gemini Bridge managed-runtime directory.

The user's global/user-local Antigravity installation is only an acquisition source; production Bridge runs use the verified app-managed copy below the Gemini Bridge local-data directory. A candidate managed runtime is accepted only when:

- the source `agy` resolves to a real regular executable path;
- a bounded real `--version` probe reports a semantic version at least 1.1.20;
- Setup copies that exact executable into a unique app-owned runtime sibling;
- a second bounded probe of the copied executable reports exactly the same version.

The exact copied version is recorded in `runtime.json`; the Host repeats runtime verification and fails closed on version drift.

### Browser extension

The browser panel is optional. It is an unpacked Manifest V3 extension intended for current Chrome/Edge Chromium builds. Because this development release is not distributed through Chrome Web Store or Edge Add-ons, loading it is a manual browser step.

The standalone local Dashboard works without the extension.

## 4. User mental model

A user only needs to understand four objects:

- **Project** — Gemini-side project name, optional local workspace and optional context/handoff text.
- **Thread** — Gemini conversation history inside a Project.
- **Workspace** — local directory used only for Review and Agent Edit.
- **Pending Agent change** — a snapshot that Gemini modified but which has not necessarily been applied to live files.

The user does **not** need to understand SQLite rows, request IDs, host locks, pairing-token internals, snapshot manifests or process identities during normal use.

## 5. Primary user workflows

### 5.1 Fresh installation

Expected experience:

1. Extract the release ZIP to a normal local folder.
2. Run `Setup.cmd`.
3. Setup displays six high-level stages instead of appearing frozen during runtime work.
4. Release files and prerequisites are checked before installed state is modified.
5. An existing supported Host is placed into maintenance and stopped safely if necessary.
6. A supported Antigravity CLI is found, or acquired through one of two official Windows installer transports (CMD/curl TLS1.2 first, PowerShell TLS1.2 fallback), then exact-version copied into the managed Bridge runtime **before the immutable program tree is swapped**.
7. The new Host is started and verified as the **exact instance started by this Setup transaction**.
8. The Dashboard opens whether or not Google is already connected; if needed, its **Sign in with Google** button starts Antigravity authentication directly.
9. Desktop/Startup shortcuts have already been installed after the exact candidate Host passed verification.
10. Authentication is not a destructive Setup gate: incomplete sign-in leaves the verified installation installed and can be completed later from the Dashboard.

If Google sign-in is incomplete, the already-healthy program installation is retained. Setup opens the Dashboard; the user can click **Sign in with Google** to start Antigravity authentication directly. Provider status is probed through Antigravity and real provider validity is ultimately proven by an authenticated request.

### 5.2 Ask Gemini

Ask requires no local workspace.

In the browser panel, first opening creates a starter `My project` when no project exists and automatically connects that starter project to the current ChatGPT page. This avoids forcing a new user to understand the page-binding model before sending the first prompt.

Flow:

`User prompt → local UI/extension → authenticated loopback Host → Bridge Core → managed Antigravity CLI → Google → streamed result → SQLite history → UI`

Ask never gives Gemini access to local project files. Because Ask has no workspace side effect, an Ask in a different thread is not blocked merely because Review/Edit currently owns that project's workspace lock; same-thread and global process-capacity limits still apply.

### 5.3 Review a local project

Review requires a Workspace.

If the user chooses Review without a workspace, the UI stops **before creating a run**, opens Project settings and tells the user to paste the full local folder path. A Windows Explorer **Copy as path** value with surrounding quotes is accepted.

Flow:

`Live workspace → validated sanitized snapshot → Gemini read-only file tools → analysis response`

The live workspace is not modified by Review.

### 5.4 Agent Edit

Agent Edit also requires a Workspace.

Flow:

1. Bridge validates the workspace and creates a sanitized snapshot.
2. Gemini runs with edit-capable file tools only against that snapshot.
3. Gemini cannot write the live workspace directly.
4. Bridge independently validates the post-Gemini snapshot.
5. A diff is computed.
6. The run becomes `WAITING_APPLY` if there are changes.
7. The user opens **Preview** to inspect before/after content.
8. The user explicitly chooses **Apply** or **Discard**.

The product requirement is: **no live Agent file mutation before explicit Apply**.

### 5.5 Apply

Apply revalidates the original workspace identity and live-file baselines before copying reviewed changes.

Possible outcomes:

- `APPLIED` — reviewed changes reached the live workspace.
- `APPLY_CONFLICT` — an external live edit was detected; nothing conflicting is overwritten.
- `APPLY_RECOVERY_REQUIRED` — Apply may have been interrupted and requires reconciliation.

The UI translates these internal states into human instructions. For example, conflict is shown as:

> Nothing was overwritten — a live file changed. Reconcile safely.

### 5.6 Reconcile

Reconcile compares:

- original baseline;
- current live file;
- desired snapshot state;
- Apply journal information when present.

It determines which changes are already applied, still pending, or externally conflicted. It must never use uncertainty as permission to overwrite a live file.

### 5.7 Discard

Discard deletes the local pending Agent snapshot when the run is safely discardable.

Discard does **not** mean “undo files already applied.” If reconciliation proves that part of an Apply reached the live workspace, the Bridge refuses an unsafe discard path rather than implying rollback semantics it cannot guarantee.

### 5.8 Handoff back to ChatGPT

Bridge can generate explicit handoff text containing project context, recent successful Gemini conversation and pending Agent state.

This is the supported bridge between the two providers. The product does not attempt to read hidden ChatGPT Project Memory or inject content into ChatGPT private APIs.

## 6. Installation layout on Windows

### Immutable/current program tree

`%LOCALAPPDATA%\Programs\GeminiBridge`

Contains installed release scripts, Node source, Dashboard assets, tests/documentation and the immutable source copy of the extension.

### Mutable application data

`%LOCALAPPDATA%\GeminiBridge`

Important children:

- `state-v3\` — SQLite database, runtime configuration, Host/process metadata, run snapshots and recovery artifacts;
- `runtime\` — versioned app-managed Antigravity executable runtimes;
- `antigravity-home\` — isolated Antigravity settings/profile home used by Gemini Bridge (account secrets remain in the OS keyring);
- `web-extension\` — mutable unpacked extension copy containing the local generated pairing configuration;
- `launcher\` — generated Unicode-safe Host launcher;
- `backups\` — bounded retained upgrade/state backups.

### User-visible shortcuts

Setup creates:

- **Gemini Bridge** — opens the Dashboard and attempts to start Host if needed;
- **Sign in with Google** in the Dashboard — starts/refeshes Antigravity authentication directly through the authenticated local Host;
- Startup shortcut for the background Host.

## 7. Component architecture

### `Setup.ps1` / `Setup.cmd`

Responsibilities:

- verify release manifest;
- serialize Setup/Uninstall with a Windows mutex;
- resolve a supported Node/npm pair;
- safely coordinate with an existing Host;
- perform offline state validation and backup;
- stage/replace program files;
- verify/acquire a supported Antigravity CLI and copy the exact verified binary into the managed runtime;
- generate runtime configuration;
- generate mutable extension pairing configuration;
- start and cryptographically/operationally identify the new Host instance;
- install shortcuts;
- commit or roll back the release transaction;
- guide first authentication and open Dashboard.

### `Uninstall.ps1` / `Uninstall.cmd`

Responsibilities:

- serialize against Setup;
- start/reach the installed Host if necessary;
- enter maintenance;
- reject uninstall while unfinished runs/management operations exist;
- prove exact Host process identity;
- shut Host down and prove process exit;
- remove program/extension pairing files;
- optionally remove history, Google Bridge profile, backups and managed Antigravity runtime.

Uninstall is intentionally fail-closed when ownership or unfinished work cannot be verified.

### `Launch-Dashboard.ps1`

Reads local runtime configuration, verifies/starts the Host, rejects a stale Host with the wrong release version, then opens the paired local Dashboard.

### `Auth-GeminiBridge.ps1` and `src/auth.mjs`

Compatibility entry point that launches the managed Antigravity interactive authentication flow in a Bridge-owned empty working directory. The Dashboard normally starts the same flow directly through `/v1/auth/start`; no Desktop sign-in shortcut is required. Authentication status is provider-probed, not inferred from credential files.

Authentication writes/uses the isolated Antigravity settings profile, while account secrets remain in the operating-system keyring. Bridge probes provider authentication state after the interactive flow instead of inspecting a credential file. **Host health remains a runtime/version health check and does not make Host health an OAuth-validity oracle**. Token expiry/refresh/account acceptance is ultimately verified only when Antigravity contacts the provider.

### `src/host.mjs`

The loopback HTTP Host:

- binds only `127.0.0.1`;
- authenticates API calls with the local pairing token;
- enforces Host/Origin policy;
- serves the local Dashboard;
- validates API bodies and limits;
- exposes Core operations;
- manages startup diagnostics, process/instance identity and orderly shutdown.

### `src/core.mjs`

The orchestration layer:

- project/thread/run creation;
- idempotency;
- thread/workspace/process concurrency control;
- snapshot lifecycle;
- prompt/context package construction;
- Gemini process ownership;
- run state transitions;
- Apply/Reconcile/Discard;
- maintenance/readiness;
- crash recovery and cleanup.

### `src/store.mjs`

SQLite persistence for projects, immutable context revisions, threads, runs, turns and settings.

Important DB choices:

- WAL mode;
- foreign keys enabled;
- `busy_timeout=5000`;
- `synchronous=FULL`;
- explicit `BEGIN IMMEDIATE` transactions for multi-step state mutations.

### `src/snapshot.mjs`

Owns the filesystem safety boundary for Review/Agent:

- workspace identity;
- traversal and path normalization;
- sensitive/excluded files;
- Unicode/Windows-portable path collision checks;
- symlink/hardlink defenses;
- binary/UTF-8 filtering;
- secret-pattern filtering;
- baseline hashes;
- diff, preview, Apply journal and reconciliation.

### `src/gemini.mjs`

Owns the Gemini process contract:

- isolated Gemini environment;
- generated mode-specific settings;
- pinned version probing;
- process-tree termination;
- stream-json parsing;
- output/error limits;
- deterministic workspace-trust bypass for Bridge-owned working directories;
- mode-specific tool allowlists.

### `src/runtime-config.mjs`

Creates/repairs local runtime configuration, pairing token and loopback port and serializes initialization through a local lock.

### `src/offline-check.mjs`

Read-only upgrade safety check performed while the prior Host is fully stopped.

### `ui/`

Standalone local Dashboard. It uses a pairing token delivered by the trusted local launcher in a URL fragment, moves it into session storage and removes the fragment from the visible URL.

### `web-extension/`

Optional Manifest V3 ChatGPT panel:

- `content.js` owns the isolated Gemini UI on `chatgpt.com`;
- `background.js` is the only extension component that talks to the loopback Host;
- `config.js` in the installed mutable copy contains local token/port generated by Setup.

## 8. Local Host security model

### Network binding

Host binds to `127.0.0.1` only. It is not intended to accept LAN or Internet traffic.

### Pairing authentication

Runtime configuration contains a random 256-bit hex token. API clients send it as `X-Gemini-Bridge-Token`.

Host checks token shape and compares it using `crypto.timingSafeEqual`.

### Host header and Origin

The Host accepts the expected loopback Host header and restricts web Origins. The browser extension is allowed through extension origins; unrelated web pages are not trusted merely because they can reach localhost.

### Request limits

Request bodies are bounded to 1 MiB. Header size/count and server request/header/keepalive timeouts are also bounded.

### Dashboard token handling

The static Dashboard file itself does not embed the token. The launcher opens the Dashboard with token information in the URL fragment; fragment data is not sent as HTTP request data. The UI stores pairing information in session storage and removes the fragment from the visible URL.

### Browser extension permissions

The shipped MV3 manifest requests:

- `storage` permission;
- `http://127.0.0.1/*` Host permission;
- content-script execution on `https://chatgpt.com/*`.

It does not request browser cookie, history or browsing-data permissions.

## 9. ChatGPT/OpenAI non-interference

Gemini Bridge is architected so normal Bridge usage does not consume ChatGPT/Codex API tokens through an OpenAI API integration because there is **no OpenAI API integration** in the Bridge.

The browser panel:

- uses its own prompt textarea;
- does not submit ChatGPT's native composer;
- does not read OpenAI authentication cookies/session tokens;
- does not call private OpenAI endpoints;
- does not delete/archive ChatGPT conversations;
- does not expose the local Bridge pairing token into the page DOM;
- places its UI in a closed Shadow DOM;
- keeps route-aware bindings tab-local in `chrome.storage.session`, rather than sharing bindings globally by URL.

The exact behavior of the ChatGPT website itself remains controlled by OpenAI. Gemini Bridge cannot provide an external guarantee about account-side policy decisions made by OpenAI, but it does not intentionally automate ChatGPT-account actions.

## 10. Gemini isolation and permissions

### Separate profile

Gemini Bridge uses its own `antigravity-home` for Antigravity settings. Antigravity account tokens remain in the operating-system keyring; Bridge does not copy or parse them.

### Generated settings are rewritten per invocation

Persistent policy files are not treated as authoritative. Mode policy is regenerated from current code before each Gemini invocation so an old/tampered broader policy does not silently survive.

### Tool exposure

- Ask: no local file tools.
- Review: read-oriented file tools.
- Agent Edit: approved file edit tools against the sanitized snapshot.
- Shell execution is not exposed to Agent in this release.
- The current Antigravity tool boundary is the generated fine-grained `permissions.deny` policy plus the sanitized workspace/snapshot boundary. Shell commands, URL/browser actions, MCP, unsandboxed execution and non-workspace access are denied; Ask also denies file access and Review denies writes. Legacy Gemini `tools.core` fixtures remain only for regression compatibility tests.

### Folder trust

Bridge-owned working directories (empty Ask cwd and sanitized Review/Edit snapshot) are created/validated by Bridge. Invocations pass `--skip-trust` so behavior does not depend on mutable Gemini Folder Trust defaults or an interactive prompt in a headless run.

This is not permission to trust an arbitrary live user directory: Gemini receives the Bridge-owned snapshot, not the live workspace.

## 11. Snapshot security model

### Directory exclusions

Examples include:

- `.git`;
- `.gemini`;
- `node_modules`;
- common dependency/build/cache directories;
- temporary directories.

### Sensitive filenames

Examples include:

- `.env*`;
- `wp-config.php`;
- `.npmrc`, `.pypirc`, `.netrc`;
- SSH private-key names;
- credential/secret files;
- service-account files;
- `.pem`, `.key`, `.p12`, `.pfx`, JKS/keystore files.

### Secret content checks

The scanner blocks several high-confidence key/token patterns and credential assignments. It handles structured JSON credential keys and common text assignment styles while allowing obvious environment-variable placeholders.

This is **defense in depth, not a mathematical DLP guarantee**.

### Filesystem limits

Current snapshot limits:

- max depth: 24;
- max entries: 12,000;
- max total snapshot bytes: 80 MiB;
- max individual file: 3 MiB;
- max relative path length: 320 characters.

Binary/non-UTF-8 content is not treated as editable text content.

### Windows-portable paths

Bridge rejects/skips Windows-problematic output such as reserved names, colon-containing segments and trailing-dot/space names. It also detects case/Unicode-normalization path collisions that could map to the same Windows path.

### Symlink/hardlink protections

Symlinks/reparse-like link behavior is not trusted as ordinary content. Hardlinked files are excluded/blocked using link-count and identity checks. File identity is rechecked around snapshot reads to reduce TOCTOU exposure.

## 12. Apply and conflict safety

Agent edits happen in the snapshot. Before an Apply, Bridge compares the live workspace against the captured baseline and verifies workspace identity.

An external edit causes conflict instead of overwrite.

Apply uses staged writes and a journal to make interrupted operations reconcilable. On restart, runs left in `APPLYING` become `APPLY_RECOVERY_REQUIRED` and require reconciliation.

### Known residual: final compare/replace micro-window

Portable Node filesystem APIs do not provide a true cross-process compare-and-swap primitive for “replace this file only if another arbitrary editor has not modified it between the final hash check and replacement.” Bridge minimizes this window with baseline rechecks, staging, atomic replacement and reconciliation, but a final microscopic race remains a documented residual risk.

Zero-risk semantics here would require a more platform-specific architecture and materially more complexity. The current release treats this as an explicit accepted residual, not as a hidden PASS.

## 13. Run state model

User-facing text intentionally hides most internal states, but developers/support need to understand them.

### Normal execution

- `QUEUED` — durable run record created.
- `RUNNING` — Gemini execution/snapshot work active.
- `COMPLETED` — Ask/Review or no-change Edit completed.
- `WAITING_APPLY` — Agent produced snapshot changes waiting for user action.
- `APPLYING` — reviewed snapshot is in the Apply transaction.
- `APPLIED` — Apply completed.
- `DISCARDED` — pending snapshot deliberately discarded.
- `FAILED` — terminal failure.
- `CANCELLED` — terminal explicit cancellation without recoverable edits.

### Recovery states

- `RECOVERY_REQUIRED` — interrupted/cancelled Agent left meaningful snapshot changes.
- `RECOVERY_PROCESS_ALIVE` — exact prior Gemini process is still alive; reconciliation is blocked.
- `RECOVERY_IDENTITY_UNKNOWN` — PID exists but exact ownership cannot be proved; Bridge refuses to act on PID alone.
- `ORPHAN_PROCESS_ALIVE` — non-edit Gemini process survived Host loss and blocks the same thread until it exits.
- `ORPHAN_IDENTITY_UNKNOWN` — ownership of a legacy/corrupt orphan PID cannot be proved.
- `APPLY_CONFLICT` — live content differs from baseline/desired state.
- `APPLY_RECOVERY_REQUIRED` — Apply was interrupted/uncertain and must be reconciled.

Terminal states are `COMPLETED`, `APPLIED`, `DISCARDED`, `FAILED` and `CANCELLED`.

## 14. Concurrency and idempotency

### Idempotency

Every run uses a `requestId`. Reusing the same request ID with the same request fingerprint returns the existing run. Reusing it for different content fails with `IDEMPOTENCY_KEY_REUSE`.

### Thread lock

A thread cannot start a conflicting new execution while a blocking run/orphan is active.

### Workspace lock

Review/Edit operations use workspace identity locking to avoid concurrent conflicting operations against the same physical workspace.

### Gemini process capacity

The default Core limit is three simultaneous Gemini processes, bounded internally to the range 1–16.

### Management lock

Apply/Reconcile/Discard are serialized through management locks. Maintenance readiness is false while a management operation remains active.

### Maintenance barrier

Once Host maintenance begins, new state-mutating management operations and new Gemini runs fail with a maintenance error. Upgrade/uninstall wait for unfinished runs, process slots and management operations to reach a safe state.

## 15. Process identity and cancellation

PID alone is not trusted because Windows can reuse PIDs.

Bridge associates running Gemini/Host processes with exact process identity. On Windows, process identity is based on process start time (`StartTime.Ticks`) together with PID ownership proof.

The authoritative Gemini process-tree termination primitive:

1. recognizes both normal exit and signal termination;
2. uses `taskkill.exe /T /F` on Windows;
3. records/observes the `taskkill` outcome but treats **confirmed target-process exit** as the success criterion rather than blindly trusting an exit code;
4. waits for confirmed termination;
5. fails rather than claiming successful termination when process-tree exit cannot be proved.

Core does not maintain a second independent `taskkill` implementation.

## 16. Host singleton and release-instance identity

The authoritative runtime singleton is ownership of the loopback port. `host.lock.json` is diagnostic/recovery metadata rather than the sole arbitration primitive.

A Host health response includes release/instance data including:

- program version;
- Host instance ID;
- PID;
- exact process identity;
- optional Setup launch nonce.

During an upgrade, Setup generates a unique launch nonce and accepts the candidate Host only when health identifies the expected release and the exact launch transaction. This prevents an old/stale Host from accidentally satisfying the new-release health gate.

Rollback force-termination is allowed only after the live process is proven to be the exact candidate started by that Setup transaction.

## 17. Installer transaction model

Upgrade is treated as a transaction rather than a blind file copy.

High-level sequence:

1. Verify exhaustive `MANIFEST.sha256`.
2. Acquire Setup/Uninstall mutex.
3. Resolve supported Node and paired `npm.cmd`.
4. Inspect authenticated Host and exact process ownership.
5. Enter maintenance and require upgrade readiness.
6. Shut old Host down and prove exact process exit.
7. Perform read-only offline SQLite/state check.
8. Back up state and stage program files.
9. Verify/reuse/install the pinned managed Antigravity runtime.
10. Repair/write runtime config and validate paths after readback.
11. Stage mutable extension pairing files.
12. Start candidate Host with launch nonce.
13. Verify expected program version, Gemini version, instance identity, process identity and nonce.
14. Install/update shortcuts.
15. Commit.
16. Only after commit, clean old backups/runtimes according to retention.
17. Complete Google sign-in if needed and open Dashboard.

A pre-commit failure attempts rollback. If a matching candidate launch nonce exists but its live process ownership is ambiguous, rollback itself fails closed **before restoring program/state over that potentially live process**. A provably dead/stale candidate lock can be discarded; a provably owned candidate is shut down and its exact exit is verified. Post-commit cleanup failure does not replace a verified healthy new installation with an older one.

## 18. Native PowerShell output discipline

PowerShell functions can accidentally return uncaptured native stdout as pipeline output. Earlier candidates demonstrated this class in real Windows acceptance: npm success text became part of a runtime path.

0.4.6 therefore treats native-process output and control return values separately:

- native output is displayed explicitly to the user while the function returns only a small structured control object; native text is never the success-path return value used as a path;
- paths must resolve to exactly one scalar value;
- control characters/newlines are rejected;
- required paths must exist as files;
- managed Gemini entry must remain under the managed runtime root;
- runtime paths are validated again after serialization/readback.

Any new installer function that invokes native executables must preserve this separation. Hidden PowerShell launcher paths are explicitly quoted before they are passed through Windows PowerShell 5.1 `Start-Process`, and generated launcher text is UTF-8 with BOM so Unicode profile paths do not depend on legacy ANSI decoding.

## 19. Gemini stream-json contract

Gemini Bridge runs Gemini headlessly with stream-json output.

Important parser rules:

- `message` assistant/model content contributes streamed partial text;
- a final `result` event is required for a successful execution;
- final result status and process exit code determine terminal success/failure;
- intermediate `type:"error"` events can be diagnostics/warnings and are **not automatically terminal**;
- malformed JSONL, missing final result, oversized output or nonzero process exit fail closed;
- unknown well-formed event types may be ignored unless they violate bounded-output rules.

### Output limits

Current Gemini process limits include:

- final/assistant output budget: 4 MiB;
- raw stream-json stdout budget: 32 MiB;
- retained stderr/diagnostic tail: 256 KiB.

The raw transcript budget is intentionally larger than final output because tool-use/tool-result events can contain file content even when the final answer is small. The stream remains bounded to prevent runaway memory use.

## 20. Prompt and context packaging

A run package includes:

- mode instruction;
- immutable Project context revision captured when the run was created;
- bounded recent successful Gemini thread history;
- current explicit user request.

Current limits:

- incoming prompt: 160,000 UTF-8 bytes;
- Project context: 120,000 UTF-8 bytes;
- full Gemini package: 300,000 UTF-8 bytes;
- recent thread-history contribution: up to 80,000 bytes subject to package budget.

The current explicit task wins over older context in the generated instruction text.

## 21. SQLite and data integrity

Persistent data is stored in `state-v3\bridge.sqlite`.

Core design rules:

- state transition updates include expected prior status;
- a transition that loses a race fails with `RUN_STATE_RACE`;
- run completion and conversation turns are committed together;
- context is revisioned rather than silently mutated for an already-created run;
- crashes are reconciled from durable DB state plus snapshot/journal/process identity.

The release test suite contains DB BUSY/FULL/READONLY/corruption and interrupted-operation cases. Real storage hardware failures can still exceed what software simulation can guarantee; ambiguous state is handled fail-closed where possible.

## 22. Browser extension lifecycle

### Page binding

The extension keeps a Bridge Project/Thread binding for the current ChatGPT route key. The first automatically created starter project is auto-bound to remove unnecessary first-use friction. Manually created/switched projects still use **Use here** so the extension does not guess user intent.

Current binding is route-based, not a private ChatGPT project-ID integration. Two tabs on exactly the same route can therefore share the same stored binding. This is a known UX semantic, not an isolation claim about ChatGPT accounts.

### Polling

Run polling is serialized with a tokenized recursive timeout. A previous request cannot continue an old poll loop after a route/run change.

Background Host fetches use an AbortController timeout so a broken localhost connection cannot leave the UI waiting forever.

### Browser/service-worker restart

Runs belong to the Host, not to the browser tab/service worker. Reloading or restarting the UI should reconnect to durable run state rather than restart Gemini work.

## 23. Dashboard behavior

The Dashboard is a first-class client, not only a debugging screen.

Important UX rules:

- Ask works without a Workspace.
- Review/Edit preflight missing Workspace before run creation.
- API requests have bounded timeout.
- internal run status is translated into user-oriented text;
- provider failure shows a reason rather than only `FAILED`;
- Apply conflict explains that nothing was overwritten and points toward Reconcile;
- stale Host release mismatch is rejected by the launcher rather than silently opening the wrong server.

## 24. Error handling philosophy

### Fail closed for ambiguity

Examples:

- cannot prove live Host ownership → do not overwrite/kill it;
- cannot prove orphan Gemini ownership → do not kill PID;
- live file differs from baseline → do not overwrite;
- runtime path is ambiguous/contaminated → do not launch;
- installed Gemini version drifts → Host unhealthy;
- unknown/corrupt recovery state → preserve evidence rather than silently discard.

### Preserve a useful diagnostic

Host startup writes bounded `host-startup-error.json` when initialization cannot reach normal health. Setup prefers this precise diagnostic over a generic health timeout when possible.

### User-facing vs internal errors

Internal diagnostic codes remain useful for support/tests, but primary UI flows should answer:

1. What failed?
2. Was user data changed?
3. What should the user do next?

## 25. Common troubleshooting

### Setup says Gemini CLI installation/probe failed

Do not manually edit `runtime.json`.

The message should include the underlying managed-runtime diagnostic. Re-run Setup after correcting the stated Node/npm/network/runtime problem. Setup uses a new versioned Gemini runtime when an old one cannot be safely reused.

### Setup reports Host health/runtime failure

Use the exact diagnostic printed after `New Host failed runtime health verification:`. The Host also writes a bounded startup diagnostic into local state.

Setup should restore the pre-upgrade program/state/runtime when the transaction failed before commit.

### Setup says live Host ownership cannot be proved

Do not kill a PID manually just because it appears in a lock file. Close/reboot the old Bridge normally or Repair once process ownership is unambiguous.

### Google sign-in was cancelled

The program may still be installed and healthy. Open the Dashboard and click **Sign in with Google**; complete the Antigravity/browser authentication before sending requests.

### Dashboard cannot reach Host

Use the **Gemini Bridge** shortcut rather than opening a raw localhost URL. The launcher attempts to start Host and checks the expected release version before opening the Dashboard.

### Extension says pairing is required

Run Setup/Repair, then press **Reload** for the unpacked extension in `chrome://extensions` or `edge://extensions`. Pairing data is generated in the mutable local extension copy.

### Review/Edit says workspace is required

Open Project settings and paste the full local project-folder path. Explorer **Copy as path** output with quotes is accepted.

### Apply reports a conflict

Do not retry blindly. The message means the live workspace changed after the Agent snapshot baseline. Use Preview/Reconcile; Bridge intentionally did not overwrite the conflicting live file.

### Apply recovery is required

The prior Apply may have been interrupted. Reconcile before any new edit for that workspace.

### Uninstall refuses to continue

Resolve unfinished Agent/recovery work first. If exact Host ownership cannot be verified, run Setup/Repair or restart Windows rather than forcing deletion of state.

## 26. Privacy and data flow

### Stored locally

Depending on use, Bridge stores:

- project names/context;
- Gemini thread history;
- run metadata/results;
- local workspace path/identity;
- temporary sanitized snapshots/pending Agent changes;
- pairing/runtime configuration;
- isolated Gemini OAuth/profile data;
- bounded backups/recovery metadata.

### Sent to Gemini

- Ask: current request + bounded Project context/history.
- Review/Edit: the above plus Gemini's file-tool access to the **sanitized snapshot**, within the mode allowlist.

Excluded files are not intentionally included in the snapshot.

### Not intentionally sent/read by Bridge

- ChatGPT cookies/session tokens;
- hidden ChatGPT Project Memory;
- browser history;
- unrelated directories outside the selected workspace;
- excluded secret files from the sanitized snapshot.

## 27. Repair and upgrade UX

Running a newer `Setup.cmd` is the repair/upgrade path.

A successful repair can rotate local pairing configuration. Because the browser extension is unpacked and local, the user may need to press **Reload** in the extension manager after a repair/token rotation.

The installer should never ask the user to interpret `host.lock.json`, manually edit a token or guess which Node/Gemini executable the Host uses.

## 28. Release manifest and package integrity

Every release package contains `MANIFEST.sha256` listing every package file except the manifest itself.

Setup refuses:

- missing manifest;
- malformed line;
- unsafe/escaping path;
- duplicate path;
- missing file;
- hash mismatch;
- unlisted extra file.

The ZIP itself receives a separate external SHA-256 file because embedding the ZIP's own hash inside itself would be circular.

## 29. Test architecture

The project intentionally separates several evidence types.

### Main regression (`npm test`)

Covers normal behavior plus accumulated hardening phases: state transitions, idempotency, concurrency, recovery, filesystem safety, Host/API security, runtime policy, installer/static invariants and product UX contracts.

### Installer/runtime gate (`npm run test:installer`)

Focuses on the classes that previously failed on real Windows:

- PowerShell native-output contamination;
- npm package/bin metadata;
- path boundaries;
- Gemini exact-version probing;
- runtime config corruption/repair;
- Host startup diagnostics and port races.

### Stress/fuzz (`npm run stress:fuzz`)

Covers high-value concurrency and exact snapshot boundaries without turning arbitrary random testing into a release metric.

### Real Chromium task E2E

The parent 0.4.5 hardening tree was exercised in real Chromium 144 against the actual Host/Core/SQLite with only the external Gemini provider replaced by the deterministic fake. In the current container, enterprise browser policy blocks normal web origins and all unpacked-extension installation (`ExtensionInstallBlocklist=["*"]`). The release evidence therefore separates two claims instead of bypassing that policy:

- a **23/23 real Chromium Dashboard/runtime flow** executes the shipped `ui/app.js` and real Host through a test-only CDP transport adapter, covering starter first-use, Ask, Review without live mutation, Agent Edit → Preview → Apply, external conflict, safe Reconcile, Discard, provider failure, reload/state restoration, pairing-token absence from DOM, and no native ChatGPT composer/history mutation;
- MV3-specific properties such as closed Shadow DOM, minimal manifest permissions, `chrome.storage.session` tab-local route binding, service-worker token isolation, timeout/overlap handling and route-change protection remain covered by product regression/static contracts in this environment.

A true installed unpacked-extension Chrome/Edge pass remains a frozen-ZIP real-environment acceptance gate; policy-blocked execution is never reported as extension E2E PASS.

### Real environment acceptance

Some claims cannot honestly be promoted to PASS from a Linux/container test:

- Windows PowerShell/winget process behavior;
- NTFS reparse/sharing/AV semantics;
- exact user's Node 24 Windows runtime;
- real Google OAuth and provider account lifecycle;
- real Edge policy/service-worker behavior.

These remain final acceptance gates for the frozen ZIP.

## 30. Regression discipline

A code change invalidates earlier full-suite evidence.

For a meaningful package of changes:

1. write code physically to a dev tree;
2. run targeted reproducer/tests;
3. run main full regression;
4. run installer/runtime gate if relevant;
5. run stress/fuzz;
6. repeat relevant browser/task E2E;
7. only then update release evidence.

A timeout, interrupted test, skipped environment test or historical TAP log is not a PASS for the changed tree.

## 31. Mutation testing philosophy

For important guards, passing tests are not enough; a useful test should become red when the protection is deliberately removed in a disposable copy.

Prior mutation exercises have covered representative protections including authentication, idempotency, version pinning, hardlink filtering, Apply conflict detection, transactionality, secret filtering and installer path contamination.

Mutation copies must never be used as release trees.

## 32. Developer module map

When changing behavior, start in the smallest authoritative layer:

- runtime installation/path/version → `Setup.ps1`, `src/managed-gemini-probe.mjs`, `src/runtime-config.mjs`, `src/version-policy.mjs`;
- provider process ownership/termination → `src/process-control.mjs`;
- command-line maintenance/offline/runtime helpers → `src/cli.mjs`;
- Google sign-in wrapper → `Auth-GeminiBridge.ps1` + `src/auth.mjs`;
- Host HTTP/auth/startup → `host.mjs`;
- project/run/state/concurrency → `core.mjs` + `store.mjs`;
- workspace/snapshot/apply → `snapshot.mjs`;
- Gemini process/protocol/tools → `gemini.mjs`;
- standalone client UX → `ui/app.js`;
- ChatGPT panel UX → `web-extension/content.js`;
- extension network boundary → `web-extension/background.js`.

Avoid duplicating authoritative primitives. The process-tree cancellation bug class is an example: termination belongs in one shared primitive, not separate implementations in Core and Gemini runner.

## 33. Adding a feature safely

Before coding:

1. State the user job being improved.
2. Identify the trust boundary and persistent side effects.
3. Decide whether the feature needs workspace access.
4. Define legal state transitions.
5. Define failure/retry/cancel/restart behavior.
6. Decide what happens during Setup/maintenance.
7. Define useful user-facing errors.

After coding:

1. add targeted success + failure + exact-boundary tests;
2. add concurrency/recovery tests if the feature mutates durable state;
3. add a cross-component test if the change crosses a boundary;
4. run all release gates;
5. update this document when user contract, architecture, limits or recovery semantics changed.

## 34. Things contributors must not do casually

Do not:

- use global Gemini CLI state as the managed runtime;
- trust a runtime because `npm install` returned zero without validating metadata/real version;
- let PowerShell native stdout become a path/control return value;
- kill processes using PID alone;
- bypass Preview/Apply for Agent live-file edits;
- turn a conflict into overwrite convenience;
- expose shell merely to make an Agent test easier;
- move pairing token into page DOM or ChatGPT page JavaScript;
- add broad browser permissions without a concrete product requirement;
- claim environment-only tests passed because a simulator passed;
- update release code after freeze without rebuilding/revalidating the artifact.

## 35. Release-freeze procedure

For a final candidate:

1. Start from a physically verified dev tree.
2. Ensure documentation/version metadata is current.
3. Run syntax/static scans.
4. Run the main full regression.
5. Run installer/runtime gate.
6. Run stress/fuzz.
7. Run current-tree Chromium task E2E.
8. Run ChatGPT/Codex non-interference checks.
9. Scan deployable package for secrets, runtime DB/state, `node_modules`, temp/stage/journal artifacts and orphan processes.
10. Regenerate exhaustive `MANIFEST.sha256` **after all package files, including this documentation, are final**.
11. Verify the manifest.
12. Build ZIP.
13. Compute external ZIP SHA-256.
14. Extract ZIP into a new clean directory.
15. Verify internal manifest from that extraction.
16. Rerun critical suites from the extracted ZIP.
17. Compare freeze tree and extracted package.
18. Verify tests did not mutate package contents.
19. Verify no Host/Gemini/test processes remain.
20. Write external `RELEASE_VALIDATION.md` describing exact evidence and blocked real-environment gates.

After the ZIP is frozen, do not edit files inside it. Any product change requires a new freeze and new checksum.

## 36. Windows acceptance procedure for the frozen ZIP

Use the exact frozen artifact, not the dev tree.

Minimum high-value acceptance:

1. Fresh `Setup.cmd` on the target Windows machine.
2. Verify installer stages and no opaque hang during Gemini npm installation.
3. Complete real Google sign-in.
4. Open Dashboard successfully.
5. Real Ask through the managed Antigravity CLI and an authenticated Google account.
6. Sequential Ask/thread continuity.
7. Review a disposable local workspace.
8. Agent Edit → Preview → Apply on disposable data.
9. External edit conflict → no overwrite → Reconcile.
10. Explicit Cancel.
11. Host restart/recovery.
12. Chrome unpacked extension.
13. Edge unpacked extension.
14. Repair/upgrade over existing state.
15. Pairing rotation + extension Reload.
16. Failed-upgrade/rollback path when safely reproducible.
17. Uninstall with and without retained local data.
18. Verify no unexpected ChatGPT conversation/account changes.

Agent Edit acceptance must use disposable/test data until confidence in the environment-specific filesystem path is established.

## 37. Current known limitations and accepted residuals

- Real Windows installer execution cannot be fully proven by Linux test automation.
- Real Google OAuth expiration/account switching/rate-limit behavior is provider/environment-dependent.
- Edge must still be checked in the actual target environment even when Chromium compatibility tests pass.
- Route-based browser binding can be shared by tabs at the identical ChatGPT route.
- Secret filtering is defense-in-depth, not perfect DLP.
- The final compare/replace micro-window during Apply is not a true OS-level CAS against an arbitrary external editor.
- Agent does not execute shell/tests in 0.4.8.8; edits may require the user/another tool to run project-specific verification afterwards.
- Bridge does not automatically synchronize hidden ChatGPT Project Memory.
- Very large/binary/secret-heavy repositories are intentionally reduced by snapshot safety limits rather than fully mirrored.

These limitations should be evaluated against user need before adding complexity. A theoretical edge case is not automatically justification for a larger privileged architecture.

## 38. Product/UX acceptance principles

A technically safe feature is not complete if a normal user cannot finish the intended job.

For each primary task ask:

- Is the next action obvious without internal terminology?
- Are unnecessary decisions removed?
- Does the user learn whether live files changed?
- On failure, does the UI state what happened and the safe next step?
- Can a browser/Host restart resume instead of forcing the user to reconstruct state?
- Does the product avoid asking the user to understand tokens, PIDs, manifests, runtime paths or DB state?
- Does safety add a deliberate confirmation only where the consequence justifies it?

Examples embodied in 0.4.6:

- Ask does not require a workspace.
- The first starter project auto-connects to the current page.
- Review/Edit without workspace redirect the user to the setting before creating a failed run.
- Explorer quoted paths are accepted.
- Preview is required before the user chooses Apply.
- Conflict says that nothing was overwritten and offers Reconcile.
- Provider failure shows a reason.
- Fresh Setup completes sign-in before normal Dashboard use.

### Task success criteria

The product is considered usable only when the user can complete these jobs without learning internal state-machine terminology:

| User job | Minimal successful path | Safe failure/recovery criterion |
| --- | --- | --- |
| Ask Gemini | Open Dashboard/panel → type → Send | No workspace required; independent Ask is not blocked by a workspace-only Review/Edit lock; same-thread/busy conditions explain the next action. |
| Review a project | Save a valid folder → Review → Send | Missing workspace is caught before run creation; Review never changes live files. |
| Edit a project | Agent Edit → Preview → explicit Apply | No live mutation before Apply; conflict says nothing was overwritten and presents Reconcile. |
| Recover after interruption | Reopen UI → see pending/recovery state → Preview/Reconcile/Discard where legal | User is not asked to reason about PID/token/SQLite internals or manually kill an unverified process. |
| Install / reopen | `Setup.cmd` stages → sign-in if needed → Dashboard | Slow native work shows progress; cancelled sign-in keeps a healthy install; launcher either starts the exact release Host or tells the user to run Setup/Repair. |

A technically correct internal state that leaves the user unable to determine whether live files changed is a UX failure, not a successful release outcome.

## 39. Release quality interpretation

A large number of green automated tests does not by itself mean “production ready.” Evidence is strongest when it covers the actual boundary where failure can occur.

For Gemini Bridge, the highest-value final evidence is the combination of:

- deterministic automated core/recovery/security tests;
- real Chromium task E2E;
- a physically immutable verified ZIP;
- real Windows Setup/NTFS/process behavior;
- real managed Antigravity CLI + Google keyring/browser authentication;
- real Chrome and Edge acceptance.

Blocked environment tests must stay visibly blocked rather than being converted to PASS by inference.

## 40. Glossary

**Bridge Host** — local authenticated loopback HTTP process that owns Core and SQLite.

**Project** — Gemini-side logical project/context/workspace configuration.

**Thread** — Gemini-side conversation stream stored by Bridge.

**Workspace** — user-selected live local directory.

**Snapshot** — Bridge-owned sanitized text copy used by Review/Agent.

**Baseline** — hashes/identity of live files when snapshot was created.

**Preview** — before/after representation of pending Agent snapshot changes.

**Apply** — explicit operation that attempts to copy reviewed snapshot changes into live workspace after conflict checks.

**Reconcile** — compare baseline/live/desired/journal after conflict or interruption.

**Pairing token** — random local secret authenticating Dashboard/extension to Host.

**Process identity** — PID plus exact process-start identity used to avoid acting on a reused PID.

**Launch nonce** — per-Setup random identifier proving that a healthy candidate Host is the specific Host launched by the current release transaction.

**Maintenance** — Host state that blocks new work while upgrade/uninstall waits for a safe durable boundary.

**Managed Antigravity runtime** — exact-version copied `agy` executable owned by Gemini Bridge, separate from the user-local acquisition copy.

**Antigravity home** — isolated Antigravity settings/profile directory used by Bridge; account tokens stay in the OS secure keyring.

## 41. Final operational rule

When debugging or releasing Gemini Bridge, prefer this order of evidence:

**physical release tree → targeted reproducer → full regression → stress/fault tests → real boundary test → documentation/history.**

Never reverse that order by assuming a feature exists because a prior chat, handoff or old report says it exists.


## 0.4.6 post-freeze hardening

The final 0.4.6 hardening pass extends the release invariants beyond the original 0.4.6 reconstruction. App-owned write boundaries are explicit: `runtime.json`, SQLite state, managed Gemini entry paths, Setup/Uninstall roots, `backups`, `launcher`, `gemini-home`, `policies`, `auth-empty`, and Agent `run-data` snapshot destinations reject unsafe reparse/junction/symlink redirection. Runtime JSON has one safe read-only loader for executable consumers, including interactive OAuth.

State integrity is checked consistently both at Host startup and during read-only upgrade readiness: required tables/columns, `PRAGMA foreign_key_check`, project/context relationships, run/thread/project consistency and workspace/workspace_id pairing are validated fail-closed. Project creation and its initial context revision are one transaction. Existing installations missing `bridge.sqlite` do not silently create empty state during upgrade or uninstall.

Process and HTTP hardening includes exact-length resource routes, an early UI Send gate, stable idempotent `requestId` reuse after uncertain delivery, bounded `--version` failure even when process termination fails, cancellation attempts for every active run during shutdown, and an irreversible maintenance gate after `/shutdown` is accepted. Host singleton startup treats a live PID with missing/legacy identity as ambiguous rather than stale.

Browser MV3 binding remains tab-local and route-aware in `chrome.storage.session`; `tabs.onRemoved` deletes bindings so a reused tab ID cannot inherit a previous project/thread. This cleanup does not require the sensitive `tabs` permission, and the manifest remains minimal.


## 0.4.6 Windows manifest acceptance hotfix

0.4.6 does not claim a new browser-behavior change; Dashboard/Host route behavior remains covered by the full regression while the hotfix changes the Setup release-manifest boundary and release version metadata.

Real Windows Setup acceptance exposed a cross-platform manifest-path mismatch: Unix `sha256sum` style output used `./file`, while Windows release enumeration produced `file`. 0.4.6 defines manifest names as canonical release-root-relative forward-slash paths without `./`. `Setup.ps1` also canonicalizes an optional benign `./` prefix before lookup, after which the existing rooted-path and `..` traversal rejection remains authoritative. The release regression additionally compares the manifest path set and SHA-256 values against every shipped file, excluding only `MANIFEST.sha256` itself.


## 0.4.8.8 Antigravity authentication/runtime hotfix

0.4.8.8 preserves the 0.4.8.1 Product Polish interaction model and migrates production provider execution to Google Antigravity CLI because the prior individual Gemini CLI client is no longer accepted by Google for this account tier. Setup verifies Antigravity >=1.1.20, copies the exact executable into an app-owned versioned runtime, records its exact version, and Host health checks the same binary before becoming ready.

Dashboard authentication is now first-class: **Sign in with Google** sends only a fixed `POST /v1/auth/start` request to the authenticated loopback Host. Host launches the managed `agy` interactively so its normal browser OAuth/keyring flow can complete, while the UI polls fixed `GET /v1/auth/status`. No user-provided executable path or shell command crosses the HTTP API. The previous sign-in shortcut is removed by Setup.

Provider execution uses Antigravity `stream-json`. Review uses `plan`; Agent Edit uses `accept-edits` only inside the sanitized snapshot. Bridge-owned Antigravity settings deny command execution, URL/network tools, MCP, unsandboxed execution and non-workspace access; Ask additionally denies file access and Review denies writes. The existing Bridge snapshot/CAS/Apply/Reconcile/Discard boundary remains authoritative.

## 0.4.7 UX/reliability release

0.4.7 keeps the 0.4.6 Windows/package and filesystem/state hardening invariants and changes the user-facing reliability model. A failed or cancelled run is now represented in the durable local **conversation** view as a UI-history item containing its original prompt/mode/status/error. This fixes the previous failure mode where terminal refresh reloaded only successful `turns`, making the user's prompt and provider diagnostic disappear. Failed attempts remain excluded from the successful Gemini model-context turns. Dashboard and the ChatGPT panel render a persistent human error card, expandable technical diagnostics and **Retry / Повторить**. Retry creates a new run attempt; it does not mutate the historical failed run.

Dashboard and ChatGPT panel now share bilingual **RU/EN** terminology. Russian browser locale defaults to Russian, users can switch explicitly, and document language is updated. Dashboard persists only the non-sensitive language preference in `localStorage`; the pairing token remains in `sessionStorage`. Extension language preference uses `chrome.storage.local`, while route/project binding remains tab-local in `chrome.storage.session` and pairing credentials remain outside content/page storage.

The Dashboard first-use structure hides empty thread/pending machinery, explains the three user modes (`Спросить`, `Анализ проекта`, `Изменить файлы`), replaces browser prompts with product dialogs, and separates Bridge runtime health from Google credential presence. The presentation layer is intentionally ChatGPT-like rather than IDE-like: integrated neutral sidebar, centered readable conversation column, restrained user bubbles, persistent error cards, elevated composer, coherent dialogs, light/dark tokens, `:focus-visible`, disabled/loading treatment, responsive layout and `prefers-reduced-motion`. The optional ChatGPT panel uses the same visual language inside its closed Shadow DOM.

This visual work does not change the underlying safety workflow. Review remains read-only against a sanitized snapshot. Agent Edit still works only on its snapshot and requires Preview plus explicit Apply/Reconcile management. Existing request-id idempotency, exact-route matching, app-owned/reparse write boundaries, SQLite state integrity, shutdown/maintenance and process-identity contracts remain authoritative.


## 0.4.8.8 Top-100 / Top-70 Windows setup hardening

A real 0.4.8.5 Windows upgrade failed before staging because Windows PowerShell could not create the SSL/TLS secure channel while downloading the Antigravity installer. This was treated as a class failure rather than a one-line retry fix. The ranked audit is recorded in `RISK_AUDIT_TOP100.md`; the highest-risk 70 contracts are executable in `tests/top70-risk-audit.mjs`.

The corrected dependency transaction is: release-manifest verification → authenticated maintenance/readiness → exact Host shutdown → offline state check → state backup → **Antigravity discovery/acquisition and exact probe** → program staging → runtime/config write → strict Host health → commit. Thus a network/TLS failure occurs before program-tree replacement. Google documents both Windows installation methods (`install.cmd` through curl and `install.ps1` through PowerShell), plus `--skip-path` / `--skip-aliases`; Bridge uses both independently and avoids changing the user's shell profile.

The same pass confirmed and fixed adjacent classes: stale native exit-code assumptions around PowerShell launchers, stale-first-candidate Antigravity discovery, official-path precedence, reparse/symlink candidate rejection, bounded retry for managed runtime copy, downloaded-installer sanity checks, bounded network timeouts, fail-closed unreadable Host locks in Setup and Uninstall, guarded legacy runtime property access under StrictMode, and server-side duplicate-auth launch suppression. Ask remains `default`, Review `plan`, and Agent Edit `accept-edits` only in a sanitized snapshot.

This is still not equivalent to a physical Windows acceptance result. Corporate TLS interception/custom CAs, Windows Credential Manager policy, antivirus/EDR locks, default-browser OAuth behavior, and future upstream Antigravity protocol/installer drift remain environment risks and are ranked 71–100 for subsequent acceptance.


## 0.4.8.8 browser OAuth code completion

A real Antigravity OAuth callback on Windows proved that Google returns a one-time authorization code with the instruction to paste it into the application. Dashboard now owns that handoff. `POST /v1/auth/start` starts a Bridge-owned Antigravity child with piped stdin; Dashboard immediately opens an authorization-code dialog. `POST /v1/auth/code` accepts a bounded single-line code over the already token-authenticated localhost API and writes it once to the waiting child's stdin. `GET /v1/auth/session` exposes only non-secret state, and `POST /v1/auth/cancel` terminates the owned child. The code is not persisted or logged. Host shutdown also terminates an outstanding auth child.
