# Gemini Bridge 0.4.8.8 — Antigravity hotfix validation report

## 0.4.8.8 current-tree evidence


### Real Windows regression added to the suite

0.4.8.6 failed on a machine with an existing `%LOCALAPPDATA%\agy\bin\agy.exe` because PowerShell dynamic scope resolved release `$Source` to caller-local `$source`, producing the impossible helper path `agy.exe\src\managed-antigravity-probe.mjs`. Phase AI now requires explicit `$script:ReleaseRoot`, distinct external/runtime variables, no critical-root shadowing, bounded candidate probing, bounded managed-copy retries, exact-version reprobe, and no mutation of the user's external `agy.exe`.

This hardening pass was triggered by repeated real Windows failures. It retains the `$Host` automatic-variable guard and adds a ranked Top-100 risk analysis with executable coverage for the highest-risk 70 items. The newest observed failure was Windows PowerShell reporting that it could not create a protected SSL/TLS channel while downloading Antigravity.

The current physical tree keeps Google Antigravity CLI as the production provider and direct Dashboard authentication (`POST /v1/auth/start` + `GET /v1/auth/status`) while fixing upgrade regressions discovered from a real 0.4.8.3 Windows install attempt. The immediate failure was a PowerShell StrictMode dereference of a legacy `runtime.json` without the newer `provider` property. The same audit hardened other optional legacy runtime/host-lock properties in Setup rollback and Uninstall. It also found and fixed an independent behavior regression: Ask had been mapped to Antigravity `plan`; the contract is now Ask=`default`, Review=`plan`, Agent Edit=`accept-edits`.

Fresh current-tree automated evidence:

- canonical regression/hardening, including Top-50 and Top-70 gates: **446/446 PASS** (every `npm test` file exactly once, run in bounded groups);
- dedicated Top-70 high-risk audit: **70/70 PASS**;
- retained Top-50 likely-regression audit: **50/50 PASS**;
- installer/runtime K+L: **24/24 PASS**;
- stress/fuzz: **8/8 PASS**;
- Antigravity migration Phase AH: **7/7 PASS** (also included in the 440 canonical total).
- Windows managed-runtime scope/self-update regression Phase AI: **12/12 PASS** (also included in the 440 canonical total).

The Top-70 gate expands this around the failure-prone Windows upgrade path: TLS1.2 and two official installer transports, bounded network behavior, safe installer-content checks, acquire-before-stage transaction ordering, multi-candidate Antigravity discovery, managed-copy retries, fail-closed corrupt Host locks, legacy StrictMode reads, runtime/path/provider invariants, direct auth launch suppression, Antigravity stream terminal semantics and output bounds, snapshot/apply/reconcile safety, management/shutdown races and request idempotency. `RISK_AUDIT_TOP100.md` records the full ranked 100 and the exact defects found.

This environment cannot execute Windows PowerShell, Windows Credential Manager or browser OAuth end-to-end. A real Windows Setup + Google sign-in + authenticated Ask remains an explicit acceptance gate and is not represented as an automated PASS.

## 0.4.8.8 final package proof

After documentation synchronization and manifest regeneration, the final freeze contains **81 files including `MANIFEST.sha256`**, no release symlinks and no transient `.git`, `node_modules`, SQLite/runtime lock/PID/log state. The final ZIP is extracted into a new directory and recursively compared with the freeze tree with **zero differences**. The clean extraction then repeats **446/446 canonical regression/hardening**, **24/24 installer/runtime**, **8/8 stress/fuzz**, and **15/15 documentation contracts**. Phase AB is part of the 440 canonical total and re-verifies exact manifest file-set/hash equality from the extracted package.

## Historical 0.4.7 evidence retained for regression provenance

This report records evidence reproduced from the current physical 0.4.7 development tree. It does not claim final ZIP/fresh-extraction validation until that package-level gate is performed.

## Historical 0.4.7 automated gates

- Main regression/hardening: **292/292 PASS**.
- Installer/runtime hardening: **24/24 PASS**.
- Stress/fuzz: **8/8 PASS**.
- Fresh Chromium 144 Dashboard/Host UX harness: **19/19 PASS** after the RU/EN reliability redesign and final CSS restyle.
- Documentation contract: **10/10 PASS** after synchronization of this report.

The 292-test regression includes the inherited process/runtime/state/installer/browser hardening plus Phase AC failed-attempt conversation history, Phase AD Dashboard RU/EN/first-use UX, Phase AE ChatGPT-panel parity, and Phase AF presentation contracts for Dashboard and panel. Phase AF was captured red as **0/7** on the earlier prototype-like CSS and is now **7/7 PASS**.

## Failed-attempt reliability

A failed Ask no longer disappears when terminal polling refreshes the thread. The durable conversation view keeps the original prompt, mode/status and diagnostic error as a failed-run UI-history item. Dashboard and ChatGPT panel show a human-readable error card, **Retry / Повторить**, and expandable technical details. Reopening the UI preserves the failure. Successful Gemini `turns` remain separate, so a failed/cancelled provider attempt does **not** enter model context. Retry creates a new run attempt while retaining the historical failure.

## RU/EN and visual UX

Dashboard and ChatGPT panel are bilingual **RU/EN**, defaulting to Russian for a Russian browser locale while allowing an explicit persisted switch. The new presentation uses integrated neutral surfaces, a centered conversation column, compact sidebar, segmented mode selection, elevated composer, user/assistant hierarchy, durable error cards, coherent dialogs, explicit hover/focus/disabled states, first-class dark mode, responsive behavior and reduced-motion support. Empty thread/pending sections remain truly hidden.

The optional ChatGPT panel keeps its closed Shadow DOM and the same visual language. Its language preference is non-sensitive and isolated from pairing credentials. Styling does not target or mutate ChatGPT's native composer/history.

## Fresh Chromium 144 evidence

The current 0.4.7 Dashboard completed **19/19 PASS** against a real local Host/Core/SQLite with deterministic fake Gemini provider execution. Coverage includes Russian locale default, first-use empty state, successful Ask, persistent failed Ask, retained original prompt, Retry, technical details, RU/EN switching, fresh Dashboard reopen, repeated durable failed attempts, pairing-token absence from DOM and no targeting of native ChatGPT composer/history.

The container has enterprise browser restrictions including `ExtensionInstallBlocklist=["*"]` and blocked ordinary localhost/file/data navigation. The Dashboard harness therefore executes the unchanged shipped `ui/index.html`, `styles.css` and `app.js` in real Chromium while replacing only the policy-blocked localhost HTTP transport and providing `crypto.randomUUID` on the unsafe `about:blank` test origin. Installed unpacked-extension execution remains **environment-blocked** here and is not falsely claimed as PASS. Real Chrome/Edge unpacked-extension acceptance remains a Windows/environment gate.

## Inherited security/hardening coverage

0.4.7 retains the 0.4.6 hardening baseline: app-owned reparse/junction/symlink boundaries for `runtime.json`, SQLite and managed write roots; shared SQLite schema/column, **foreign key** and semantic **state integrity** checks; atomic project/context creation; process-identity Host ownership; irreversible shutdown/maintenance admission; exact resource routes; bounded HTTP/process output; and idempotent unchanged retries using the same **requestId / request ID** when delivery is uncertain.

Shutdown waits for active management work including **Apply/Reconcile/Discard**; once shutdown has been accepted, maintenance admission cannot be reopened. Production provider execution uses the exact-version managed **Antigravity CLI** runtime; legacy Gemini CLI fixtures remain only for inherited regression compatibility. Version/process control stays centralized and stream-json output remains bounded by the **32 MiB raw-stream** budget while warning/error events are diagnostic until the terminal result.

The Windows manifest acceptance fix also remains authoritative: internal `MANIFEST.sha256` release paths are canonical without Unix `./` prefixes, Setup safely canonicalizes an optional benign `./`, rooted/`..` traversal stays forbidden, and Phase AB compares the manifest file set plus every SHA-256 against the shipped tree.

## 0.4.7 mutation proof

Fresh disposable-copy mutation checks killed **4/4** representative UX/reliability regressions:

- changed durable `failed-run` conversation items to an unknown kind → Phase AC failed in Core/reopen/HTTP coverage;
- changed the global `[hidden]` CSS rule to display hidden sections → Phase AD failed;
- removed the real `prefers-color-scheme: dark` media contract → Phase AF failed;
- redirected the extension RU/EN preference from `chrome.storage.local` into session storage → Phase AE failed.

Mutation copies were deleted and are not release trees. Inherited process/state/manifest mutation classes remain covered by the baseline suite.

## Environment limits and release status

This Linux/container environment cannot execute true Windows PowerShell/winget/NTFS Setup/Uninstall, real Google **OAuth** refresh/provider lifecycle, antivirus/file-sharing behavior, or installed Chrome/**Edge** extension policy behavior end-to-end. Those remain real Windows acceptance items.

A separate physical 0.4.7 freeze tree reproduced **292/292 regression + 24/24 installer/runtime + 8/8 stress/fuzz + docs 10/10 + Chromium 19/19 PASS** with zero release symlinks/runtime-state artifacts. A provisional clean extraction then reproduced the same **292/24/8/docs/Chromium** gates, passed internal `MANIFEST.sha256` file/hash validation, and had **zero recursive differences** from the freeze source. Final immutable-ZIP extraction is still pending here, so no final package SHA is claimed yet. The archive checksum design remains intentionally non-circular: once an immutable final archive is built, publish its SHA-256 in a **separate `GeminiBridge-0.4.7.zip.sha256`** file rather than embedding the ZIP hash inside the ZIP.


## 0.4.8.8 OAuth code-flow regression

A real Windows Antigravity callback showed the browser instruction to paste a one-time code into the application. Phase AJ covers the new Bridge-owned auth child, one-time stdin submission, bounded/non-persistent code handling, authenticated start/code/session/cancel routes, Dashboard code UI, cancellation and cleanup.
