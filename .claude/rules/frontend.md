---
paths:
  - 'apps/web/**'
  - 'apps/admin/**'
  - 'apps/mobile/**'
  - 'packages/ui/**'
---

# Frontend rules

- Build on Campus Verse tokens (packages/ui/src/styles.css). The hub language (docs/decisions/0022): warm paper, white panels (`panel`), hairline borders, brand navy (`navy-950`, #04266D) for the main action and links, a navy sidebar with a cyan active pill. No off-the-shelf look.
- Fonts as on campusverse.app: Instrument Sans for text, Plus Jakarta Sans for headings.
- Cyan is never text on white (about 2:1). Use navy on cyan or cyan on navy.
- No walls of stat cards. Gradients only in the `midnight` surface and the KeyFigures hairline. Key numbers go in one KeyFigures strip; work goes in the Day Line, worklists, grids and side panels. Panels get the soft `--shadow-card`; stronger shadows only on overlays.
- Every screen starts with `PageHeader` (open on the page: section eyebrow with the area's icon, title, one-line purpose, actions on the right, tabs as children; only the dark home card shows `art`) and uses `EmptyState` (with `art` on first-run screens). Pages never set their own width: the shell's 1240 px column aligns everything. Area colours tint heroes, icon tiles and avatars, never text or buttons. Illustration accents (sun, coral, mint, lilac, skin) only inside `Illustration`.
- No fixed bottom bars. Search and commands live in the header's command palette (Ctrl K).
- Every screen has loading, empty, error, offline and permission-denied states.
- All user-facing words come from language files. Same action name from button to confirmation.
- WCAG 2.1 AA: visible focus, full keyboard access. Respect prefers-reduced-motion.
- Marks and money use tabular numbers.
- Server state lives in TanStack Query, not global stores. Forms use React Hook Form with Zod contracts.
- Bulk actions open the Preview Canvas.
- Create and edit forms open in `FormModal` (with `ModalField`), never inline between existing content.
