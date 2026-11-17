# @campusverse/ui

Campusverse tokens and components. Import `@campusverse/ui/styles.css` once; it brings Tailwind with only Campusverse colours.

| Component                                                                     | Use                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DayLine`, `AttentionList`, `KeyFigures`                                      | The day as a lane-based schedule with the now line; what needs attention; the day's key numbers in one strip                                                                                            |
| `CommandPalette`, `CommandTrigger`                                            | Header search that opens a centred palette: Find, Do, Ask Verse AI. Ctrl K / ⌘K                                                                                                                         |
| `PreviewCanvas`                                                               | Full-screen check before any bulk action: what changes, who is affected, risks, undo. The confirm button repeats the action's name                                                                      |
| `ScopeChip`                                                                   | Campus · institution · year, always visible, with a switcher                                                                                                                                            |
| `RecordDrawer`                                                                | Opens a record from any name without leaving the work                                                                                                                                                   |
| `FormModal`, `ModalField`                                                     | Every create and edit form, over the page: title, scrolling body, sticky actions, error, focus returns on close                                                                                         |
| `DataGrid`                                                                    | Marks entry: arrow keys, type to replace, paste from Excel, frozen names, instant error marking, autosave status. Blank is never zero                                                                   |
| `StatePanel`, `OfflineBanner`, `Announcer`, `Button`                          | Shared states, confirmations and actions                                                                                                                                                                |
| `PageHeader`, `Section`, `Toolbar`                                            | Page frame: icon, title, purpose and actions; titled panels; search and filter rows                                                                                                                     |
| `Illustration`                                                                | Original flat scenes (welcome, students, attendance, fees, admissions, exams, certificates, notices, yearEnd, setup, settings, search, empty) drawn with theme tokens; decorative (docs/decisions/0019) |
| `EmptyState`, `SkeletonRows`                                                  | First-run guidance with the action; loading skeletons (`aria-busy`)                                                                                                                                     |
| `IconTile`, `Avatar`, `Pill`, `Stat`, `Progress`, `ProgressRing`, `Segmented` | Area-coloured tiles, initials, status pills, numbers and progress, two-to-four way switches (docs/decisions/0018)                                                                                       |

Components take their words through `labels` props, so text lives in each app's language files.

Brand files are in `assets/brand` (`@campusverse/ui/brand/*`). Tests: `src/**/*.test.ts` (pure logic); visual, accessibility and keyboard checks live in `apps/web/e2e`.
