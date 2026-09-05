# Gemini Bridge 0.4.8.8 — Security model


## 0.4.8.8 upgrade/runtime regression hardening


The 0.4.8.8 follow-up also removes implicit PowerShell dynamic-scope dependence from the release root. All immutable release-helper lookups use `$script:ReleaseRoot`; the external Antigravity executable is held separately as `$externalEntry`. This prevents a caller-local variable from redirecting an executable/helper path. A self-updating external `agy.exe` is treated as an acquisition source only: Bridge copies it to a new app-owned runtime, exact-version reprobes the managed copy, retries boundedly on source drift/transient locks, and never mutates the user's external Antigravity installation.

0.4.8.8 hardens the Antigravity migration without widening privileges. `Setup.ps1` and `Uninstall.ps1` run under PowerShell `Set-StrictMode`; therefore JSON from an older installation is treated as a versioned compatibility boundary. Optional legacy fields such as `provider`, `geminiEntry`, `geminiVersion`, `nodePath`, `pid`, `processIdentity`, `instanceId` and `launchNonce` are inspected through guarded property lookup where absence is legitimate. Missing identity data remains fail-closed when ownership cannot be proven; it no longer turns into an accidental StrictMode property exception during migration or rollback.

The downgrade guard accepts historical three-part and current four-part numeric Bridge versions, while malformed or missing `programVersion` is rejected before destructive staging. Rollback still restores prior program/state/runtime configuration before cleanup and only restarts the previous Host when Setup itself had stopped it.

The Antigravity mode boundary is explicit: **Ask → `default`**, **Review → `plan`**, **Agent Edit → `accept-edits`**. Review and Agent Edit keep their existing sanitized-snapshot and permission-deny boundaries; Agent Edit still cannot mutate the live workspace before explicit Preview/Apply. The Top-70 high-risk gate specifically covers legacy state migration, rollback/uninstall ownership, TLS-bounded managed Antigravity acquisition/versioning, stream-json, mode selection, shell/network/MCP denial, direct Dashboard Google authentication, token isolation, Apply/Reconcile/Discard concurrency and manifest integrity. The ranked Top-100 register is `RISK_AUDIT_TOP100.md`.

## 0.4.8.3 Antigravity runtime and authentication boundary

0.4.8.3 replaces the retired individual **Gemini CLI 0.55.1** transport with **Google Antigravity CLI** while preserving the existing Bridge Host/Core/Snapshot/Apply security boundary. Setup accepts Antigravity CLI **1.1.20 or newer**, verifies its real `--version`, copies that exact binary into a versioned app-owned runtime directory, records the exact version in `runtime.json`, and Host startup fails closed if the managed binary later reports a different version.

Antigravity runs with a Bridge-owned `HOME`/`USERPROFILE` for settings and workspace policy. Account tokens remain in the operating system keyring (Windows Credential Manager on Windows); Bridge does not copy or parse those credentials. Authentication is started only through the already-authenticated loopback Host endpoint `POST /v1/auth/start`. The Dashboard “Sign in with Google” button invokes that fixed endpoint and then polls `GET /v1/auth/status`; neither endpoint accepts an executable path, arguments, shell text, or arbitrary command. The old Desktop sign-in shortcut is removed during Setup and is not required.

For real Antigravity execution, Bridge uses headless `stream-json`. Ask denies workspace file read/write plus shell/network/MCP/unsandboxed capabilities. Review permits workspace reads but denies writes and the same shell/network/MCP/unsandboxed capabilities. Agent Edit uses the sanitized snapshot as its working directory, permits workspace-local edits there, and still denies command execution, web access, MCP, unsandboxed execution and non-workspace access. Live files remain protected by Bridge Preview/Apply/Reconcile/Discard and compare-and-swap checks; Antigravity never receives direct live-workspace Apply authority.

The legacy `GEMINI_*` internal error vocabulary and legacy `.mjs` fake-provider adapter remain intentionally compatible with the existing hardening tests; this does not mean production traffic still uses the retired Gemini CLI client.

## Dependency acquisition and Windows TLS boundary in 0.4.8.8

Antigravity acquisition is deliberately outside the immutable-program swap. Setup backs up state, then tries already-installed candidates (official per-user path first) and exact-version probes them. If installation is required, it tries Google's official Windows CMD installer via `curl.exe` with HTTPS-only/TLS1.2 and bounded connect/overall timeouts; if that transport fails, it independently downloads the official PowerShell installer with TLS1.2 and a bounded timeout, then runs it in a fresh `powershell.exe` process so native exit status is not inherited from an unrelated command. Downloaded scripts are rejected if they are reparse files, implausibly sized, or look like HTML/error content. Only after a valid `agy` is acquired and exact-version probed can `Stage-Release` replace the program tree.

This reduces both availability and rollback risk but does not make corporate TLS interception trustworthy by itself. A machine whose proxy/custom CA blocks both official Google transports receives a controlled setup failure **before program replacement**. The existing installation is therefore the recovery boundary rather than a partially replaced candidate.

## Trust boundaries

1. **ChatGPT/OpenAI** and **Gemini/Google** are separate providers.
2. Bridge never reads ChatGPT cookies, session tokens, hidden Project Memory APIs, or private OpenAI endpoints.
3. A Gemini Direct prompt goes only through the local Bridge Host to Gemini CLI.
4. Gemini conversation state belongs to Bridge; a Gemini CLI process is disposable.

## Local Host

- Listens only on `127.0.0.1`.
- API requires a random 256-bit pairing token.
- Dashboard static HTML contains no pairing token. The local dashboard launcher reads `runtime.json`, passes the token only in a URL fragment, the UI moves it to session storage, and immediately removes the fragment from the visible URL. The optional unpacked extension uses a mutable local copy outside the immutable program tree.
- The loopback port bind is the authoritative Host-singleton primitive. SQLite/Core are opened only after that bind is owned; `host.lock.json` is diagnostic/recovery metadata, not the arbitration primitive.
- Request bodies are bounded and malformed JSON fails closed. Host/Origin checks reject unexpected local-web origins/Host headers.
- Setup uses authenticated maintenance/readiness when possible and additionally treats a matching or ambiguously identifiable live Windows Host lock as a fail-closed condition rather than killing an unverified PID.

The pairing token protects against accidental/other-process localhost access within the same desktop session; it is not intended to defend against a malicious process already running as the same Windows user and able to read that user's files/memory.

## Antigravity runtime

- Bridge production runs use a versioned app-owned copy of the verified `agy` executable. `runtime.json` retains the legacy field names `geminiEntry` / `geminiVersion` for state-schema compatibility, but `provider` is `antigravity`.
- Host startup performs a bounded real `--version` probe and fails closed if the exact managed version differs from `runtime.json.geminiVersion`.
- User prompt/context is sent through stdin as Antigravity `stream-json`, never interpolated into a shell command.
- Antigravity settings live below Bridge-owned `antigravity-home`; `HOME` and `USERPROFILE` point there. Directory creation uses the same app-owned reparse/junction/symlink guards as other mutable Bridge state.
- Account credentials are owned by Antigravity in the operating-system secure keyring. Bridge does not infer authentication from a profile directory or OAuth file; status is probed through the provider.
- Ask denies `read_file(*)`, `write_file(*)`, command execution, URL/network tools, MCP and unsandboxed execution.
- Review permits workspace reads but denies writes, command execution, URL/network tools, MCP and unsandboxed execution.
- Agent Edit runs only in the sanitized snapshot. It permits workspace-local edits there but denies command execution, URL/network tools, MCP, unsandboxed execution and non-workspace access.
- stdout/stderr and raw stream volume remain bounded to prevent unbounded Host memory consumption.
- Host health proves the managed executable/version can start; it does not by itself prove Google account eligibility.

## Workspace snapshot

Gemini never edits the live workspace directly.

Before Review/Agent, Bridge copies eligible text files to a separate run snapshot. It rejects or skips:

- `.git`, `.gemini`, dependency/build/cache directories;
- `.env*`, `wp-config.php`, credential/secret/key/certificate names;
- `GEMINI.md` variants;
- symlinks/junction-like links;
- binaries;
- oversized/deep/pathological workspaces;
- high-confidence private-key/API-token signatures.

After Agent finishes, Bridge enumerates the snapshot again with the same path/secret/size/depth rules. This prevents Agent from creating a newly forbidden file and passing it to Apply.

## Apply

- Explicit user action only.
- Preview is read-only and available before Apply.
- Bridge verifies workspace root identity.
- Every changed live file is compared with its baseline hash.
- External changes become `APPLY_CONFLICT`; Bridge does not overwrite them.
- Every filesystem side effect is preceded by a per-run apply journal. Stage files have a random run-attributable nonce and are removed only when their path and SHA-256 prove they belong to that exact run.
- Adding a new file uses no-clobber link semantics; a concurrently created user file becomes a conflict rather than being overwritten. Updating an existing file performs a final baseline-hash check immediately before replace and preserves the prior mode where supported.
- Partial Apply is reconciled by before/after hashes and can continue only for files still in the expected baseline state. Unknown/colliding stage content is never deleted automatically.
- Apply/Discard/Reconcile are serialized per run/workspace.

## Recovery

A Host crash does not cause automatic retry of an unknown side effect.

If a previous Gemini process is still alive after restart, Bridge verifies both PID **and process-start identity** before treating it as the same process. Legacy/ambiguous process identity fails closed; Bridge never advises killing an unverified reused PID. Agent snapshots are preserved until Apply/Discard/reconciliation. Terminal run artifacts are cleaned only when journal/hash evidence proves they belong to that run; startup garbage collection leaves unknown recovery content untouched.

## Out of scope / residual risks

- A malicious process already executing as the same Windows user is outside the local isolation threat model.
- Secret detection cannot identify every arbitrary credential format. Keep unrelated secrets outside bound workspaces and review what you bind.
- Malicious filesystem manipulation by another same-user process during a run cannot be completely prevented without an OS/container sandbox. Bridge excludes symlinks and multi-link files, rechecks path/type/hash invariants, and fails closed on Windows-unsafe/case-colliding names. A small residual race remains between the final hash check and portable rename of an existing file because Node does not expose a cross-editor atomic `replace iff hash == X` primitive.
- 0.4.6 intentionally provides no Agent shell/command execution.
- The optional browser extension is an unpacked local build until published in a browser store.


## Browser/MV3 isolation in 0.4.6

The optional chatgpt.com content UI is mounted in a **closed Shadow DOM**. Its project binding is **tab-local and route-aware**: the service worker keys records by browser tab and stores them in `chrome.storage.session`; the content script does not share a URL-global binding across tabs. The MV3 manifest requests only `storage` plus `http://127.0.0.1/*` host access.

The pairing token stays in the extension service worker/config boundary and is not intentionally exposed to the page world or native ChatGPT composer/history. Dashboard pairing is held in session storage and removed from the visible URL fragment.

## Maintenance and process safety

Process termination is centralized through `src/process-control.mjs`. Once maintenance/shutdown starts, new Gemini runs and state-mutating **Apply/Reconcile/Discard management** actions fail closed. Readiness remains false while any such management operation is active, and direct shutdown waits for already-started management operations before HTTP/SQLite teardown. Gemini stream-json handling uses a bounded **32 MiB raw-stream** budget.


## 0.4.6 post-freeze hardening boundaries

The 0.4.6 hardening pass fail-closes on app-owned reparse/junction/symlink redirects for runtime metadata, managed runtime paths, Setup/Uninstall roots, backup/launcher roots, SQLite state, Gemini home/policies/auth working directories, and Agent snapshot destinations. Host startup refuses exact-live or ambiguously-live ownership locks. SQLite startup and offline upgrade checks share structural, foreign-key and semantic state-integrity validation; project creation plus its initial context revision is transactional. HTTP resource limits, exact route shapes, idempotent request IDs, irreversible shutdown admission, bounded version probing and all-run shutdown cancellation are regression-tested.


## 0.4.7 UX/reliability and localization boundaries

0.4.7 adds durable **failed-attempt UI history** without treating a failed provider attempt as a successful model turn. The conversation endpoint may expose the original prompt, mode, terminal status and diagnostic error so Dashboard/ChatGPT panel can survive refresh and offer Retry; `turns` used to build Gemini model context still exclude failed/cancelled attempts. Retry creates a new immutable run attempt while preserving the previous failure as diagnostics.

Localization does not widen credential storage. The local Dashboard pairing token remains session-only and is never stored in `localStorage`; only the non-sensitive `gb-lang` language preference may persist there. The extension keeps tab bindings in `chrome.storage.session` and its non-sensitive RU/EN preference in `chrome.storage.local`; the pairing token remains isolated from content/page DOM. Closed Shadow DOM and minimal `permissions: ["storage"]` remain regression-tested.

The 0.4.7 visual restyle changes presentation only: light/dark surfaces, focus/disabled states and reduced-motion behavior do not alter Host/API authorization, workspace preflight, Apply/Reconcile/Discard, idempotent retry or process-ownership contracts.


### OAuth authorization-code handling (0.4.8.8)

The Google/Antigravity authorization code is treated as ephemeral credential material. It is accepted only on the token-authenticated localhost endpoint `POST /v1/auth/code`, bounded to 4096 bytes, rejected if it contains CR/LF/NUL, written once to the stdin of the Bridge-owned Antigravity authentication child, and never persisted, echoed in status APIs, or intentionally logged. Authentication sessions expire after five minutes and can be cancelled from Dashboard; Host shutdown terminates an outstanding auth child.
