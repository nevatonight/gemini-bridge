# Gemini Bridge 0.4.8.8 — Release validation

0.4.8.8 is a setup/runtime hardening release on top of Product Polish + the Antigravity migration. It incorporates the earlier version-parser, StrictMode and PowerShell `$Host` fixes, then addresses the newest observed Windows failure: inability to create an SSL/TLS secure channel while acquiring Antigravity. The new transaction uses dual official Windows installer transports, explicit TLS/time bounds, downloaded-script sanity checks, exact candidate probing and dependency acquisition before program-tree replacement. Dashboard Google sign-in still starts directly through the authenticated local Host; no separate sign-in shortcut is required.

Real Windows + real Google account acceptance remains a required post-build environment gate because this Linux build environment cannot execute the Windows PowerShell installer or Windows Credential Manager/browser OAuth end-to-end.

## 0.4.8.8 current automated evidence

- Canonical regression/hardening: **446/446 PASS** (all `npm test` files; executed in bounded groups because one monolithic harness run exceeds the surrounding wall-clock limit).
- Phase AI managed-runtime/dynamic-scope gate: **12/12 PASS**.
- Dedicated Top-70 high-risk gate: **70/70 PASS** (included in the canonical total).
- Legacy Top-50 likely-regression gate: **50/50 PASS** (also included in the canonical total).
- Installer/runtime hardening: **24/24 PASS**.
- Stress/fuzz: **8/8 PASS**.
- Antigravity migration Phase AH: **7/7 PASS** (included in the canonical total).

The canonical regression is executed file-by-file / in bounded groups because the surrounding execution harness repeatedly times out on one monolithic `node --test` process despite the same constituent files completing independently. Every file listed by `npm test` is included exactly once; counts sum to 440.

## 0.4.8.8 final package proof

The immutable release tree contains **81 files including `MANIFEST.sha256`**, no symlinks and no `.git`, `node_modules`, SQLite/runtime lock/PID/log artifacts. The final ZIP is clean-extracted into a brand-new directory, recursively compared with the freeze tree, and must report **zero differences**. From that clean extraction the release repeats **446/446 canonical regression/hardening + 24/24 installer/runtime + 8/8 stress/fuzz + docs 15/15 PASS**. Phase AB is included in the canonical total and proves the manifest path set and SHA-256 values exactly match the extracted package. This package proof is the acceptance criterion for publishing the archive; real Windows Setup/OAuth remains the separate environment gate described above.

0.4.7 is the UX/reliability successor to the sealed 0.4.6 Windows/package hotfix. It preserves the canonical Windows manifest boundary and inherited hardening while fixing failed-run visibility, adding RU/EN Dashboard/ChatGPT-panel parity, and replacing prototype-like presentation with a coherent light/dark visual system.

## Historical 0.4.7 development-tree evidence

- Main regression/hardening: **292/292 PASS**.
- Installer/runtime: **24/24 PASS**.
- Stress/fuzz: **8/8 PASS**.
- Fresh Chromium 144 Dashboard/Host UX harness: **19/19 PASS**.
- Phase AF presentation contracts: **7/7 PASS** after an initial **0/7** red baseline.

## Historical 0.4.7 physical freeze-tree proof

The separate physical freeze tree has reproduced **292/292 regression + 24/24 installer/runtime + 8/8 stress/fuzz + docs 10/10 + Chromium 19/19 PASS**. Its internal `MANIFEST.sha256` verified before the run; the tree contains no release symlinks or runtime/SQLite/Host-lock/PID/log artifacts. The 0.4.7 mutation proof killed **4/4** representative UX/reliability regressions in disposable copies.

Provisional ZIP and immutable final-ZIP clean-extraction validation are still pending at this point and are not claimed yet.

## Browser/environment boundary

Real Chromium verifies the shipped Dashboard UI via the policy-safe harness described in `TEST_REPORT.md`. Installed unpacked-extension execution is environment-blocked by the container's enterprise `ExtensionInstallBlocklist=["*"]`; real Chrome/Edge extension acceptance remains a Windows gate. Real Google OAuth/provider validity also remains environment-specific.

## Package integrity inherited from 0.4.6

The Windows acceptance manifest hotfix remains mandatory: canonical release-relative paths contain no leading `./`, Setup defensively normalizes a benign prefix while rejecting rooted/parent traversal, and Phase AB must prove exact shipped file-set and SHA-256 equality. The final ZIP checksum will be published separately only after the immutable archive exists.

## Historical 0.4.7 provisional clean-extraction proof

A provisional `GeminiBridge-0.4.7.zip` was built from this freeze tree and extracted into a brand-new directory. Archive validation found **72 file entries**, no duplicates, no path traversal, no archive symlink entries and zero `./`-prefixed manifest paths. The clean extraction reproduced **292/292 regression + 24/24 installer/runtime + 8/8 stress/fuzz + docs 10/10 + Chromium 19/19 PASS**. Internal manifest/path/hash validation passed and recursive `diff -qr` against the freeze source reported **zero differences**. No product/test orphan process remained after the harnesses completed.

The package remains provisional only because this evidence text changes the release tree. After recording it, `MANIFEST.sha256` is regenerated, the source is retested, and one immutable final ZIP must be clean-extracted again.


## 0.4.8.8 OAuth code-flow regression

A real Windows Antigravity callback showed the browser instruction to paste a one-time code into the application. Phase AJ covers the new Bridge-owned auth child, one-time stdin submission, bounded/non-persistent code handling, authenticated start/code/session/cancel routes, Dashboard code UI, cancellation and cleanup.
