---
name: design-direction
description: 'User wants a calm, enterprise-grade, visually soothing UI; campusverse.app fonts; no bottom bars'
metadata:
  node_type: memory
  type: feedback
  originSessionId: bc5af7bc-8705-4d61-9501-260fab915689
  modified: 2026-11-06T10:04:53.690Z
---

The user rejected the first design (Milestone 6) and asked for an enterprise-grade, visually soothing look. Specifics they gave: use the fonts from campusverse.app (Instrument Sans for text, Plus Jakarta Sans for headings), the dashboard was "not that great", and the fixed bottom command bar was "irritating".

**Why:** the bold navy-heavy "control room" style from the build guide didn't feel professional or calm to them.

**How to apply:** light surfaces, hairline borders, restrained navy, soft status tints, shadows only on overlays; search/commands in the header palette, never a fixed bottom bar. Recorded in docs/decisions/0006-design-revision.md and .claude/rules/frontend.md. Show screenshots for approval before spreading new screen patterns.

Update 2026-11-06: the user then found the calm design "plain, basic and amateur" and asked for UI that amazes yet stays simple and convenient. Calm is not enough on its own: also aim for warmth, guidance and shortcuts. That led to Design 2.0 (docs/decisions/0018): PageHeader with area-coloured icon tiles, EmptyState with next steps, skeletons, a soft card shadow, the New menu and quick actions.

Update 2 (same day): still "basic". The user wants out-of-the-box aesthetics with illustrations and perfect alignment, any colours as long as the primary is blue (bright royal blue, not near-black navy). Design 3.0 (docs/decisions/0019): midnight sidebar, hero cards with original SVG illustrations, one 1240 px column. Lean bold and polished, not minimal.

Update 3 (2026-11-13): the user asked for strong inspiration from their earlier product's web app (~/Projects/campusverse/campus-verse-hub/apps/web), made perfectly consistent. Decision 0022: brand navy #04266D primary, navy sidebar with a cyan active pill (navy text), warm paper page, open editorial page headers (no hero card), joined KPI strip with a cyan hairline and index, uppercase table headings. Fonts stay Instrument Sans + Plus Jakarta Sans. When unsure about a visual choice, check what the hub does.

Update 4 (2026-11-13): "inspiration" was not enough — the user wants the hub's EXACT UI (colours, alignment, shell, profiles) and was disappointed by an approximation. Decision 0022 "exact match" section: DM Sans body, navy text #04266D, hub greys/borders/shadows, 260 px navy sidebar + full-width top bar with profile, Student 360-style records. To compare, run the hub locally on spare ports (web 3100, API 3101, throwaway Mongo on 27018 seeded with apps/api/src/scripts/seed-demo-school.ts; pass every service key empty, OPENAI_API_KEY a dummy) and screenshot it. Only deviations allowed: WCAG AA fixes.
