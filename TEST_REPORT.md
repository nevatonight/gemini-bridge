# Gemini Bridge 0.4.7 — UX/reliability validation report

This report records evidence reproduced from the current physical 0.4.7 development tree. It does not claim final ZIP/fresh-extraction validation until that package-level gate is performed.

## Current automated gates

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

Shutdown waits for active management work including **Apply/Reconcile/Discard**; once shutdown has been accepted, maintenance admission cannot be reopened. Gemini CLI remains pinned to **0.55.1**. Version/process control stays centralized and stream-json output remains bounded by the **32 MiB raw-stream** budget while warning/error events are diagnostic until the terminal result.

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
