# Gemini Bridge 0.4.8.8
> **0.4.8.8 setup/runtime hardening:** triggered by repeated real Windows upgrade failures. In addition to the earlier StrictMode/version/`$Host` fixes, this build hardens Antigravity acquisition against Windows TLS failures with two official installer transports, explicit TLS/time bounds, content sanity checks and fail-safe transaction ordering. A ranked Top-100 audit was produced; the highest-risk 70 items are executable regression contracts in `tests/top70-risk-audit.mjs`.

Local Windows companion for using **Google Antigravity CLI** alongside long-running ChatGPT projects.

Gemini Bridge does **not** replace an OpenAI model on ChatGPT servers. It keeps a separate local Gemini project/thread history and provides explicit handoff between ChatGPT and Gemini.

## What 0.4.8.8 does

### 0.4.8.8 in-Dashboard Google authorization code handoff

Real Windows OAuth confirmed that Google Antigravity redirects the browser to a page that says **“Paste this code into your application to complete authentication.”** The previous Bridge build launched Antigravity in a separate interactive console, so the user had nowhere inside Dashboard to paste that one-time code. 0.4.8.8 makes the Host own the Antigravity auth child process, keeps its stdin private, shows a dedicated Dashboard code dialog, and sends the submitted code through authenticated localhost-only `POST /v1/auth/code`. The code is never written to disk, returned by status APIs, or logged. Cancel and five-minute expiry terminate the owned auth child.



### 0.4.8.8 managed-runtime correction

A real Windows 0.4.8.6 upgrade exposed a PowerShell dynamic-scope collision: the script-level release root named `$Source` was shadowed case-insensitively by a caller-local `$source` containing the external `agy.exe` path. The managed-runtime probe therefore tried to execute `...\agy.exe\src\managed-antigravity-probe.mjs`. 0.4.8.8 replaces that implicit scope with `$script:ReleaseRoot` and distinct `$externalEntry`/`$sourceFile` names. External Antigravity is now probed with bounded retries, and the managed copy is retried/reprobed if the user-local self-updating `agy.exe` changes between discovery and copy. Gemini Bridge never deletes or overwrites the user's `%LOCALAPPDATA%\agy\bin\agy.exe`.


0.4.8.8 keeps the 0.4.8.1 Product Polish UX and the Antigravity migration while hardening upgrade compatibility with older Bridge state. It also fixes a Windows PowerShell regression where local `$host` variables collided case-insensitively with PowerShell's built-in read-only `$Host` automatic variable during Setup/Uninstall. Legacy JSON is read defensively under PowerShell StrictMode instead of assuming newer properties already exist. Google sign-in now starts directly from the Dashboard button; the separate sign-in shortcut is no longer required.

- **Ask** — Gemini conversation without local project files.
- **Review** — Gemini can read a sanitized snapshot of a bound local workspace.
- **Agent Edit** — Gemini can edit only a sanitized snapshot. The live workspace is unchanged until you review **Preview** and press **Apply**.
- Local project context and Gemini history.
- Pending Agent work survives UI reload and Host restart.
- Explicit Gemini → ChatGPT handoff.
- Local dashboard that works without a browser extension.
- Optional panel on `chatgpt.com` with its own composer; it never intercepts ChatGPT's native composer.
- Failed/cancelled attempts remain visible in local UI history with the original prompt, a human-readable error, **Retry**, and expandable technical diagnostics; they are not inserted into Gemini model turns.
- Dashboard and optional ChatGPT panel are bilingual **RU/EN**. Russian browser locale selects Russian by default; the language can be switched explicitly and the preference is stored separately from pairing credentials.
- The Dashboard and ChatGPT panel share a polished neutral light/dark presentation layer with explicit focus, disabled and reduced-motion states.

## Install on Windows 10/11

1. Extract the ZIP to a normal folder.
2. Run **`Setup.cmd`**.
3. Setup accepts Node.js 22.13+ within 22.x or Node.js 24.x. Future unvalidated major versions are rejected. If Node is missing and `winget` is available, Setup attempts the Node LTS package and then re-validates the installed major/minor. An unsupported future major is refused rather than silently accepted.
4. Setup requires **Antigravity CLI 1.1.20 or newer**. It first probes the official per-user location and other executable candidates. If no usable binary exists, Setup attempts Google's official Windows **CMD/curl installer over HTTPS/TLS 1.2 with bounded timeouts**, then independently falls back to the official **PowerShell installer with TLS 1.2**. Downloaded installer content is sanity-checked before execution. The resulting `agy` binary is exact-version probed and copied into a versioned Gemini Bridge managed-runtime directory; Host startup re-probes that exact managed version and fails closed on drift.
5. The local Dashboard opens automatically. If Google is not connected, click **Sign in with Google / Войти через Google**. Bridge launches Antigravity authentication directly; Antigravity opens the browser and stores its session through the Windows credential mechanism. No separate sign-in shortcut is needed.
6. A **Gemini Bridge** shortcut is added to the Desktop and the Host starts automatically at Windows sign-in.

Program files:

`%LOCALAPPDATA%\Programs\GeminiBridge`

Local state / Gemini Bridge profile:

`%LOCALAPPDATA%\GeminiBridge`

### Optional panel inside chatgpt.com

The standalone dashboard requires no browser extension. If you want the floating Gemini panel on `chatgpt.com`, this unsigned development build requires one manual browser step:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `%LOCALAPPDATA%\GeminiBridge\web-extension`. This is the mutable local copy whose pairing configuration is generated by Setup; the immutable program tree never contains your pairing token.

This manual step exists because the extension is not published in Chrome Web Store / Edge Add-ons.

## First project

On first open, Bridge creates a starter **My project** when needed. In the optional chatgpt.com panel that starter is connected to the current page automatically, so **Ask** works immediately.

- **Ask** needs no local workspace.
- For **Review** or **Agent Edit**, open Project settings and paste the full local workspace path; Windows Explorer **Copy as path** values with quotes are accepted.
- Add a concise ChatGPT project handoff to **Project context** when useful. Gemini cannot directly read hidden ChatGPT Project Memory.
- For Agent Edit, inspect **Preview** before **Apply**.
- When you manually create/switch projects in the chatgpt.com panel, use **Use here** to choose which Bridge project belongs to that page. Bridge intentionally does not guess ChatGPT private project IDs or scrape private APIs.

## Agent safety model

Agent Edit does **not** use `git checkout`, `git worktree`, `git add`, repository hooks, or a shell. Bridge creates its own text-file snapshot and gives Gemini access only to that snapshot.

Common sensitive/unsafe material is excluded, including `.git`, `.gemini`, `.env*`, `wp-config.php`, private-key/certificate files, known credential filenames, symlinks/junctions, common dependency/build directories, binaries, oversized files, and high-confidence secret signatures.

The same checks run again **after Gemini edits** so Agent cannot create a blocked secret/config file and smuggle it into Apply.

Apply verifies the original workspace identity and per-file baseline hashes. If a live file changed meanwhile, Bridge returns a conflict instead of overwriting it.

Gemini stream-json handling keeps warning/error diagnostic events non-terminal until the final result and enforces a bounded **32 MiB raw-stream** budget.

See [SECURITY.md](SECURITY.md) for scope and limitations.

## Recovery

- Closing/reloading the dashboard or ChatGPT panel does not cancel Gemini; the background Host owns the run.
- **Cancel** is explicit.
- If Host crashes while Gemini is still alive, Bridge blocks a new turn in that thread until the orphan process exits.
- If Agent was interrupted, the snapshot is retained for reconciliation.
- If Apply was interrupted, Bridge compares baseline/live/desired hashes and can safely finish an already-partial Apply when there is no external conflict.
- Pending Agent work blocks uninstall until it is resolved.

## Updating

Run the new version's `Setup.cmd`. Setup verifies the release manifest before touching the installation, takes the shared Setup/Uninstall mutex, puts a supported running Host into maintenance, refuses upgrade while unfinished work exists, and shuts the authenticated Host down before an offline read-only state check. It then backs up SQLite/runtime state, **acquires and exact-version verifies Antigravity before replacing the program tree**, stages the new program only after that external dependency step succeeds, writes the managed runtime configuration, and starts the new Host. The upgrade is committed only after `health.ok === true` with the expected Gemini version; a pre-commit failure restores the prior program/state/runtime configuration where present. Cleanup and retention happen only after commit.

A live Host that cannot be authenticated/identified safely is not killed or overwritten; Setup fails closed and asks you to close/recover it first. The optional unpacked extension lives under `%LOCALAPPDATA%\GeminiBridge\web-extension`, outside the immutable program tree. After Setup/Repair rotates pairing data, reload that unpacked extension in Chrome/Edge.

## Uninstall

Run **`Uninstall.cmd`** from the installed folder.

Uninstall fails closed if it cannot verify state or if unfinished Agent/run work exists. Resolve pending work first. You can then choose whether to keep or delete local history, the Bridge Google profile, and the app-managed Antigravity runtime.

If you loaded the optional unpacked browser extension, remove it manually from Chrome/Edge.

## Limits of this build

- Windows Setup/Uninstall scripts are statically audited in the release tests, but this Linux build environment cannot execute a real Windows PowerShell/winget installation end-to-end.
- The automated suite uses a deterministic fake Gemini process for failure/concurrency/security testing. Host health verifies the managed Gemini executable/version, **not Google-account validity**. Authentication state is provider-probed through Antigravity rather than inferred from a local OAuth file. Real account eligibility, token refresh and provider behavior remain real-environment acceptance items and are ultimately proven by an authenticated Antigravity request.
- Secret filtering is defense-in-depth, not a mathematical DLP guarantee. Review the workspace you bind; do not keep unrelated secrets in project source folders.
- No shell/test execution is exposed to Agent Edit in 0.4.8.8.
- No automatic ChatGPT Project Memory synchronization.

## Tests

From the source/release folder:

```powershell
npm test
npm run test:installer
npm run stress:fuzz
```

The installer/runtime hardening gate is separate from the baseline regression so Windows packaging/probe failures cannot be hidden inside historical coverage. The release ZIP is validated by extracting it into a clean directory and running all three gates again from the extracted copy. `MANIFEST.sha256` inside the package verifies release files; the ZIP itself has a separate `.zip.sha256` file next to the download. See `TEST_REPORT.md` for the exact test results and `RISK_AUDIT_TOP100.md` for the ranked Top-100 audit and exact defects found during this hardening pass.

## Complete documentation

See **`PROJECT_DOCUMENTATION.md`** for the full product, architecture, security, recovery, troubleshooting, developer and release reference.
