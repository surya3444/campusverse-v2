# Rule book

"Campusverse vs CampX — Competitive Analysis & System Architecture" (13 Nov 2026, @Krishna), 136 pages.
It is the single source of product rules for this repo. CLAUDE.md summarises it; when the summary
and the text differ, the text wins.

- `rulebook.pdf`: the original.
- `rulebook.txt`: full extracted text with `<<PAGE n>>` markers. Table cells are one per line.
- `NN-*.txt`: the same text split by section. Look rules up here (grep) before building.

| File                 | Look here for                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 01-executive-summary | Nine systems, six winning positions, P0 list, naming decisions                                                    |
| 02-campx-strategy    | What CampX claims and how it sells                                                                                |
| 03-campx-systems     | CampX specifications per system (what each feature does, who uses it)                                             |
| 04-campusverse-v1    | V1 module inventory, status labels, known defects, what V1 must keep                                              |
| 05-previous-v2       | Earlier V2 plans and the 13 resolved contradictions                                                               |
| 06-system-comparison | Per-system scores; technical capabilities (tenancy, audit, API, mobile, security)                                 |
| 07-feature-mapping   | All 231 CampX features → Campusverse system › module, action (Keep/Expand/Fix/Build/Validate). The backlog source |
| 08-missing-modules   | 16 new modules and ~130 new sub-modules with priority                                                             |
| 09-missing-layers    | Functional, academic, finance, HR, operations, enrollment, AI and platform gaps                                   |
| 10-roles             | ~50 role templates: scope, dashboard, approvals, Mitra help, channel; how hierarchical access works               |
| 11-advantages        | Where Campusverse wins and what makes each advantage real                                                         |
| 12-architecture      | Why nine systems, the layers, institution profiles, the 14 architecture decisions                                 |
| 13-module-hierarchy  | Every system › module › sub-module › features › roles › institution types                                         |
| 14-mitra-ai          | Mitra vs Medha, role assistants, how Mitra is built, safe-AI action classes                                       |
| 15-compliance        | Every law, regulator rule, board rule and data system with dates and owner module                                 |
| 16-data-flow         | Source of truth per entity; the seven end-to-end workflows step by step                                           |
| 17-roadmap           | P0–P3 items with dependencies and complexity; phases and gates                                                    |
| 18-vision            | Product vision and success criteria for early 2028                                                                |
| 19-sources           | Links behind every claim                                                                                          |
