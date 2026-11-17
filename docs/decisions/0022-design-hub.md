# 0022 Design: the Campus Verse hub language

Date: 2026-11-13 · Status: accepted · Supersedes the primary colour, heroes and key figures of 0019

The owner asked for strong inspiration from the earlier Campus Verse product (campus-verse-hub/web), made fully consistent. Its look: the brand's deep navy with electric cyan, a warm off-white page, open editorial headings, joined key-figure strips and soft cards. Applied through the shared tokens and components, so every screen changed at once.

| Topic       | Decision                                                                                                                                                                                                                                              | Why                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Primary     | Brand navy `#04266D` (`navy-950`; white on it 13:1). Tints retuned from it. Shadows tinted navy                                                                                                                                                       | The Campus Verse brand colour, as in the hub             |
| Frame       | The sidebar is the brand navy with a faint cyan glow; the active item is a **cyan pill with navy text** (6.9:1) and a soft cyan glow                                                                                                                  | The hub's most recognisable detail                       |
| Page        | Warm paper `#F8F7F3`; ink `#0B1D40`; hairlines `#E4E7EC`                                                                                                                                                                                              | Calmer than cool grey, as in the hub                     |
| Page header | Open on the page, no card: an uppercase tracked eyebrow with the area's mark (navy tile, cyan icon), a 36 px bold title, one line of purpose, actions on the right, tabs and chips under it. Only the home welcome stays a midnight card with artwork | Editorial and consistent; less chrome above the work     |
| Key figures | One joined strip (`KeyFigures`) with a cyan hairline on top, uppercase tracked labels, large tabular numbers and a faint decorative index (drawn by CSS)                                                                                              | The hub's KPI strip                                      |
| Panels      | 20 px radius, hairline border, soft navy shadow; section titles in the display face                                                                                                                                                                   | Softer cards                                             |
| Tables      | Every table heading small, uppercase, tracked and muted (a base style; cells can override)                                                                                                                                                            | Tables read the same on every screen                     |
| Fonts       | Unchanged: Instrument Sans and Plus Jakarta Sans (campusverse.app), not the hub's DM Sans                                                                                                                                                             | Already chosen with the owner (memory: design direction) |

Rules kept from 0019: one 1240 px column, gradients only in the midnight surface and the key-figure hairline, illustrations only inside `Illustration` (empty states and the welcome card), cyan never as text on white, every state complete.

## Update, 13 November 2026: exact match

The owner asked for the reference's exact UI. The reference was run locally (its own synthetic demo school) and its screens measured; the tokens and components now use its values:

- **Colours:** text is the brand navy `#04266D` (as the reference's foreground); muted text `#526C98` (hsl 218 30% 46%); hairlines `#DAE0E6`; muted surfaces `#ECF0F3`; page `#F9FAFB`; success `#16A160`, warning `#F59F0A`, danger `#EF4444` for bars and dots. Text on tints keeps the darker `*-ink` shades so it passes AA.
- **Fonts:** DM Sans for text (as the reference), Plus Jakarta Sans for headings. Type scale 12, 14, 18, 24, 30, 48.
- **Shell:** a 260 px solid navy sidebar (logo row, school card with a blue building tile, 44 px rows, a cyan pill with glow for the current page, tracked section labels, Sign out at the bottom in coral); a full-width 64 px white top bar with a rounded search, the Verse AI button, New, and the profile (navy initial tile, name, role). Content sits in a 1280 px column.
- **Components:** buttons (rounded-lg, 40 px, soft shadow), badges (rounded-md, bordered tints), segmented tabs (muted track, white active), cards (rounded, hairline, faint shadow, display-face titles without a rule), the joined stat strip (navy hairline, 10 px tracked labels, 40 px numbers, CSS index), table headings (12 px uppercase on a muted band).
- **Profiles:** the student and staff records follow the reference's Student 360: a navy banner hero with the photo over its edge, name, status, contact and chips; six stat cards; segmented tabs; icon-titled panels in a main column and a 360 px side column.
- **Home:** the reference's oversized greeting, the name running navy to cyan with a cyan full stop.

Two deliberate differences, for WCAG AA: the current page's label in the sidebar is navy on the cyan pill (white on cyan is 1.9:1), and the sidebar's section labels are white at 60% (50% fails for 10 px text).

## Update: the dashboard and module pages

- **Dashboard (Today):** the reference's layout section by section — the oversized greeting; "Finish setting up" (icon tile, tasks done and remaining, gradient progress, collapsible tasks with Required and "Set up ↗"); the joined stat strip with icons (students, collected with % of billed, today's attendance, outstanding in red with "Send reminders"); "Requires attention" cards; Weekly attendance bars beside Today's pulse (collection so far, by payment mode); Student distribution donut, Admissions pipeline (leads → converted, conversion bar) and Finance breakdown (billed, collection rate bar, collected and outstanding); the Day Line; quick-action pills. New reads: `attendanceTrend` (last seven days) and `financeSummary` (billed, collected, outstanding, overdue, students cleared); student gender comes with the student list.
- **Module pages:** the reference's module pattern — a compact 24 px title with one line of purpose and the actions on the right (no eyebrow); key numbers as separate cards with a tinted icon tile (`KeyFigures` default `cards`; the dashboard and the directories use `variant="strip"`); search and filters in one white card (`Toolbar`); then table or empty-state cards.
- **Fees:** the reference's fee counter banner (date, title, today's collection) and its four cards: collected today, total collected, pending dues, students cleared.
