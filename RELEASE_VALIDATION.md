# Gemini Bridge 0.4.7 — Release validation

0.4.7 is the UX/reliability successor to the sealed 0.4.6 Windows/package hotfix. It preserves the canonical Windows manifest boundary and inherited hardening while fixing failed-run visibility, adding RU/EN Dashboard/ChatGPT-panel parity, and replacing prototype-like presentation with a coherent light/dark visual system.

## Current development-tree evidence

- Main regression/hardening: **292/292 PASS**.
- Installer/runtime: **24/24 PASS**.
- Stress/fuzz: **8/8 PASS**.
- Fresh Chromium 144 Dashboard/Host UX harness: **19/19 PASS**.
- Phase AF presentation contracts: **7/7 PASS** after an initial **0/7** red baseline.

## Physical freeze-tree proof

The separate physical freeze tree has reproduced **292/292 regression + 24/24 installer/runtime + 8/8 stress/fuzz + docs 10/10 + Chromium 19/19 PASS**. Its internal `MANIFEST.sha256` verified before the run; the tree contains no release symlinks or runtime/SQLite/Host-lock/PID/log artifacts. The 0.4.7 mutation proof killed **4/4** representative UX/reliability regressions in disposable copies.

Provisional ZIP and immutable final-ZIP clean-extraction validation are still pending at this point and are not claimed yet.

## Browser/environment boundary

Real Chromium verifies the shipped Dashboard UI via the policy-safe harness described in `TEST_REPORT.md`. Installed unpacked-extension execution is environment-blocked by the container's enterprise `ExtensionInstallBlocklist=["*"]`; real Chrome/Edge extension acceptance remains a Windows gate. Real Google OAuth/provider validity also remains environment-specific.

## Package integrity inherited from 0.4.6

The Windows acceptance manifest hotfix remains mandatory: canonical release-relative paths contain no leading `./`, Setup defensively normalizes a benign prefix while rejecting rooted/parent traversal, and Phase AB must prove exact shipped file-set and SHA-256 equality. The final ZIP checksum will be published separately only after the immutable archive exists.

## Provisional clean-extraction proof

A provisional `GeminiBridge-0.4.7.zip` was built from this freeze tree and extracted into a brand-new directory. Archive validation found **72 file entries**, no duplicates, no path traversal, no archive symlink entries and zero `./`-prefixed manifest paths. The clean extraction reproduced **292/292 regression + 24/24 installer/runtime + 8/8 stress/fuzz + docs 10/10 + Chromium 19/19 PASS**. Internal manifest/path/hash validation passed and recursive `diff -qr` against the freeze source reported **zero differences**. No product/test orphan process remained after the harnesses completed.

The package remains provisional only because this evidence text changes the release tree. After recording it, `MANIFEST.sha256` is regenerated, the source is retested, and one immutable final ZIP must be clean-extracted again.
