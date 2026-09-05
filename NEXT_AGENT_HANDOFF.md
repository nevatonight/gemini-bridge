# Gemini Bridge — NEXT AGENT HANDOFF

## Current work: 0.4.8.8 setup/runtime regression-hardening hotfix

The production provider transport has been migrated from the now-unsupported individual Gemini CLI client to Google Antigravity CLI. Dashboard **Sign in with Google** starts authentication directly through authenticated loopback endpoints; the separate sign-in shortcut is removed. Antigravity is minimum-gated at 1.1.20, exact-version copied into the app-owned managed runtime, and executed through stream-json with mode-specific deny policies. Preserve the existing Snapshot → Preview → Apply/Reconcile/Discard security boundary.

Before release, trust the physical tree, MANIFEST.sha256 and fresh tests over historical chat. A real Windows/Google authentication pass is still required after the Linux-side package gates.

Real Windows upgrades exposed three setup failure classes in sequence: legacy `runtime.json.provider` under StrictMode, `$host` colliding with PowerShell's read-only `$Host`, and finally failure to create an SSL/TLS secure channel while downloading Antigravity. 0.4.8.8 treats the third as a broader hardening trigger: two official Windows installer transports, TLS/time bounds, content sanity checks, multi-candidate runtime discovery, acquire-before-stage transaction ordering, fail-closed corrupt locks and server-side auth launch cooldown. Ask must remain `default`, Review `plan`, Edit `accept-edits`. `RISK_AUDIT_TOP100.md` ranks 100 zones; `tests/top70-risk-audit.mjs` is the mandatory 70-case gate and currently passes **70/70**. The complete `npm test` file set sums to **446/446 PASS**; the final release gate repeats it from a clean ZIP extraction alongside 24/24 installer/runtime, 8/8 stress/fuzz and docs 15/15.

## Historical 0.4.8.1 handoff

## Physical baseline

Development branch: `0.4.8.1-product-polish`

Frozen imported baseline commit: `3e26b249108803f27ac648688406705e5f361a24` (`Import Gemini Bridge 0.4.7 full baseline`).

The 0.4.8.1 Product Polish work is a UX-only continuation of the 0.4.7 safety/runtime architecture. Trust the physical tree, `MANIFEST.sha256`, tests and GitHub state over chat history.

## Product Polish implemented in this checkpoint

- Dashboard sidebar hierarchy simplified to Project → History → Gemini status → Settings.
- Pending Agent Edit work moved into the conversation flow instead of the navigation sidebar.
- Onboarding transitions into clean chat chrome after conversation activity and is removed from keyboard/accessibility interaction while hidden.
- Composer is compact, auto-expands, preserves Ctrl/Cmd+Enter, exposes the current mode and includes a hidden attachment foundation without a fake upload control.
- Agent Edit cards expose explicit progress and Preview / Apply / Reconcile / Discard actions.
- Failed terminal states are action-oriented (`Needs attention` / `Требуется действие`) rather than a bare `Failed`.
- Dashboard failed attempts provide Retry, Reconnect Google when applicable, and Technical details. Immediate submission failures also render an actionable error card.
- ChatGPT panel mirrors action-oriented failures, Google reconnect guidance, Agent progress and composer auto-expand.
- Runtime, snapshot, Apply/Reconcile/Discard, token, closed-Shadow-DOM and extension-permission safety boundaries were not intentionally changed.

## Validation contract

After any further product change run:

1. targeted UX tests (`AD`, `AE`, `AF`, `AG`);
2. the complete regression script in `package.json` (splitting the exact file list into batches is acceptable when the execution harness has a wall-clock limit);
3. `npm run test:installer`;
4. `npm run stress:fuzz`;
5. `node --test tests/documentation-contract.mjs` whenever release-facing documentation changes.

`MANIFEST.sha256` must exactly match the physical tree before treating a checkpoint as clean. Before an immutable release, copy to a separate freeze directory, regenerate/verify the manifest, build the ZIP, extract it to a brand-new directory, and repeat all gates there.

## Do not regress

- No live workspace mutation before explicit Apply.
- No uncertainty-based overwrite during Apply/Reconcile.
- No shell access for Agent Edit.
- No ChatGPT cookies/private APIs/native-composer interception.
- Pairing token remains outside page DOM and persistent extension storage.
- Closed Shadow DOM and minimal extension permissions remain intact.
- Do not change architecture/security unless a demonstrated defect requires it.

## 0.4.8.8 setup hotfix

- Fixed `Assert-NoDowngrade` rejecting four-part Gemini Bridge versions such as `0.4.8.1`/`0.4.8.2`.
- `Parse-AppVersion` now accepts 3- or 4-part numeric versions and compares them via `System.Version`.

## 0.4.8.8 real-Windows regression

0.4.8.6 failed when an existing `%LOCALAPPDATA%\agy\bin\agy.exe` was present: PowerShell dynamic scope made the script-level `$Source` release root resolve to caller-local `$source`, yielding `agy.exe\src\managed-antigravity-probe.mjs`. 0.4.8.8 uses `$script:ReleaseRoot`, `$externalEntry`, `$sourceFile`, bounded candidate probing and bounded managed-copy/exact-version retries. Never reintroduce an unscoped release-root variable or mutate the user's external Antigravity binary. `tests/hardening-phase-ai.mjs` is mandatory.


## 0.4.8.8 OAuth code-flow regression

A real Windows Antigravity callback showed the browser instruction to paste a one-time code into the application. Phase AJ covers the new Bridge-owned auth child, one-time stdin submission, bounded/non-persistent code handling, authenticated start/code/session/cancel routes, Dashboard code UI, cancellation and cleanup.
