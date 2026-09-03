# Gemini Bridge 0.4.7 — Security model

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

## Gemini runtime

- Separate `GEMINI_CLI_HOME` under Bridge state.
- Host startup performs a bounded Gemini `--version` probe. When `runtime.json` contains the release-pinned `geminiVersion`, a mismatch fails closed before the Host becomes ready; legacy configs without that field remain compatible but still must pass the probe.
- User prompt/context is sent through stdin, not interpolated into a shell command.
- The authoritative tool boundary is the Bridge-generated `tools.core` allowlist plus the isolated Gemini profile/working directory. Ask exposes no file tools; Review exposes read tools; Agent Edit exposes only the approved text-file edit tools. Shell is not in the allowlist.
- The generated policy also requests disabled auto-update/YOLO/Always Allow/skills/hooks/local `.env` behavior and no Bridge-configured MCP/extensions. These settings are defense-in-depth; the security model does not rely on a single file-based `admin` flag being authoritative in every Gemini CLI environment.
- Bridge uses a private random Gemini context filename so repository `GEMINI.md` files are not loaded as agent instructions.
- Ask gets no filesystem tools.
- Review gets read-only file tools.
- Agent Edit gets read/write text-file tools but no shell tool.
- Gemini stdout/stderr are bounded to prevent unbounded Host memory consumption.
- Host health proves the managed Gemini CLI can start with the pinned version; it does not prove that Google OAuth credentials are currently valid. Setup/Auth check isolated credential presence, while expiry/refresh/provider acceptance is a real authenticated-request concern.

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
