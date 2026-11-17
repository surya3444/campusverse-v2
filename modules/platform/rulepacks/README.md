# platform/rulepacks

Campus Core › Rule Packs (rule book §15.1, §12.4 decision 11, P0 item 5): regulation as data. A new circular is a pack version, not a software release.

- **Packs** are defined in `packages/rules` (`PACKS`): each has a payload shape (Zod), check functions its test cases call, and a built-in version 1 made from the values Campusverse has used so far. First packs: `board.cbse`, `board.cisce`, `state.KA`, `state.TS`, `state.AP`, `state.TN`, `labour.central`, `ugc.credits`. `packsFor` picks an institution's packs from its profile, board and state.
- **Catalogue** (`packCatalogue`, `draftPackVersion`, `releasePackVersion`, `discardPackDraft`; admin portal › Rule packs): support staff draft the next version (payload checked against the shape; test cases run and shown). An owner who didn't draft it releases it, and only when every test case passes. A released version never changes (database trigger).
- **Institutions** (`institutionPacks`, `adoptPackVersion`; Campus Core › Rule packs): each pack's version in use, what it sets, its sources (each marked unchecked until verified), and the newest released version with its release notes. Owners and administrators (`platform.rules.adopt`, sensitive) switch it on from a date on or after it takes effect; earlier dates keep the version they had.
- **Reading** (`packFor`, `payrollRulesAt`, `creditFrameworkAt`): the version in force at an institution on a date. Payroll (PF, ESI, professional tax) and Academics (credit frameworks, checked as of a regulation's effective date) read through here.

**Owns:** `control.rule_pack_version` (global catalogue), `rule_pack_adoption` (append-only, per tenant) (migration 0061). **Events:** `platform.rules.adopted.v1`.

**Not yet:** board rules (attendance, grading, promotion, admission age), TC deadlines and year templates still read the built-in version directly; a university's own regulations pack; the obligation register, evidence store and Verse AI Watch (§15.1 items 1, 3, 4); messages to institutions when a version is released. Test runs release synthetic versions into the shared development catalogue.
