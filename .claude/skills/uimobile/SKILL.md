---
name: uimobile
description: Review and repair WARNOTO mobile UI when invoked with `/uimobile` or Indonesian requests such as perbaiki UI mobile, tampilan HP berantakan, responsif, overflow, tombol terlalu kecil, or layout gudang di ponsel. Enforces review-first approval and bounded presentation-only edits.
---

# WARNOTO mobile UI workflow

Use this skill for a responsive UI audit or an explicitly approved, narrowly scoped presentation repair. Keep business flow, logic, schema, API contracts, and dependencies unchanged.

## Before auditing

1. Read `AGENTS.md`, `HANDOFF.md`, `CLAUDE.md`, and any relevant `docs/DESIGN*` files that exist. Do not edit `HANDOFF.md`.
2. Run `git status --short --branch`, inspect the current branch, and check for conflicts or overlapping work before touching files.
3. Use `graphify query`/`explain` once for the requested screen to locate relevant components and styles; fall back to targeted reads only after the graph result.
4. After graphify and before presenting recommendations, read the project-local `.claude/skills/responsive-design/SKILL.md` as a technical reference. Read `.claude/skills/responsive-design/references/details.md` only when the target needs responsive layout patterns beyond the short guidance (for example, container queries, intrinsic grid sizing, responsive tables, images, or navigation).
5. Invoke the read-only `.claude/agents/ui-design-reviewer.md` before any edit. It must distinguish screenshot/snapshot evidence from static inference, cite `file:line`, severity, affected files, and confirmation needed.
6. Present the audit and **PAUSE**. Make no edits until the user gives explicit approval naming the presentation scope.

The responsive-design skill is subordinate to WARNOTO `AGENTS.md`, `HANDOFF.md`, `CLAUDE.md`, `docs/DESIGN_GUIDELINES.md`, existing project patterns, the review-first pause, and the approved scope. Treat it as reference material only: do not auto-expand scope, introduce dependencies, convert the styling architecture, or override project breakpoints/tokens.

## Ownership and scope gate

Treat ATTB UI as owned by the user's parallel team. The overlap set is `src/components/AttbTab.jsx`, `src/components/AttbDashboardSummary.jsx`, `src/styles/operations.css`, and `src/index.css`. Auditing these files is allowed. Editing any overlap file requires explicit coordination confirmation from the user and must be limited to the approved presentation scope; otherwise stop and report the gate.

## After explicit approval

- Use a worker by default. Escalate to a senior only when the approved change is demonstrably cross-module, risky, or otherwise beyond a bounded UI fix.
- Edit only approved presentation files. Do not change logic, state transitions, schema, API, dependencies, or business flow.
- Preserve and reuse `OperationsHero`, `.kpi-banner`, `.approval-btn`, Phosphor icons, existing `isMobile` branches, and established light/dark tokens.
- Validate the approved viewports: 360x800, 390x844, 412x915, 768x1024, and desktop 1366/1440. Check no horizontal page overflow, 44x44 touch targets, 16px inputs, 12px text floor (except print/`ScanPublicView`), safe-area padding, grid/form reflow, scrollable `max-height:90dvh` modals, non-colliding tabs/buttons, field-table card/collapse behavior, action hierarchy, and loading/empty/error/disabled/success states in both themes.
- Apply the installed responsive-design skill's relevant verification checks at this same WARNOTO viewport matrix: overflow and intrinsic-layout behavior, touch targets, responsive images/tables/navigation, and any other pattern used by the approved view. Existing WARNOTO breakpoints and tokens remain authoritative.
- Run `graphify update .` after source changes. Run `git diff --check`, `npm run build`, and focused responsive/browser tests available for the approved screen; perform a light/dark browser verification when possible.
- Report files changed, checks run, evidence type, residual unknowns, and any confirmation still needed.

## Safety and handoff

Never commit, push, mutate production, or edit `HANDOFF.md` without explicit approval. Do not invent credentials. If scope expands or conflicts appear, stop and ask for coordination rather than guessing.
