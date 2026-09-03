# Gemini Bridge — NEXT AGENT HANDOFF

## Current baseline

Branch: `0.4.8.1-product-polish`

Baseline commit:
`3e26b249108803f27ac648688406705e5f361a24`

Message:
`Import Gemini Bridge 0.4.7 full baseline`

## Rules

- Trust physical code, tests and manifest over chat history.
- Do not change architecture or security invariants without a demonstrated need.
- Do not add new features before UX polish is complete.

## 0.4.8.1 Product Polish goals

1. ChatGPT/Linear-level UX:
   - onboarding to clean chat transition;
   - hide large mode cards after first interaction;
   - simplify sidebar.

2. Agent Edit UX:
   - clear progress states;
   - obvious Preview / Apply / Reconcile / Discard flow.

3. Composer:
   - auto-expand;
   - Ctrl+Enter;
   - clear mode indicator;
   - prepare attachment foundation.

4. Error UX:
   - never show only generic Failed;
   - provide Retry / Reconnect Google / Details actions.

## Required validation

After significant changes:
- targeted tests;
- regression suite;
- installer/runtime;
- stress/fuzz.

Before release:
- freeze copy;
- MANIFEST.sha256;
- clean extraction;
- repeat all gates.
