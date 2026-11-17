# academics/obe

Academics › OBE for colleges and universities (rule book §13.2: Program Outcomes; Course Outcomes & Mapping; Attainment; P1 item 17). Accreditation reports belong to Quality & Compliance.

- **Programme outcomes** (`outcomeSets`, `draftOutcomeSet`, `saveOutcomeSet`, `publishOutcomeSet`; `academics.obe.manage`): a programme's vision, mission, PEOs, POs and PSOs as a numbered version, with its targets (a student achieves an item from a share of its marks; levels 1–3 from shares of students; the internal assessment's weight; one target level). Published versions are frozen by a database trigger. A new version starts as a copy of the published one, and every CO's mappings are carried to the new outcomes by code.
- **Course outcomes & mapping** (`courseOutcomes`, `saveCourseOutcomes`): COs per course of a regulation, each with its CO–PO/PSO matrix row (1–3, against the programme's current outcomes; PEOs aren't mapped) and the items that measure it: the end exam (`see`), the whole internal mark (`cie`) or one internal component (`cie:N`, from the regulation's CIE plan).
- **Attainment** (`attainment`; `domain/attainment.ts`): for a published term of a batch, from first-attempt marks (academics/exams `termMarks`). A CO's level comes from the share of students achieving the target on its tagged items (absence from the end exam counts as not achieved), internal and end exam weighted. PO and PSO attainment is worked out **only** from CO levels through the matrix (Σ CO level × mapping ÷ Σ mapping) and held to the **same** target level, so COs at target with a PO below it cannot happen (rule book §17, demo defect 1; a property test holds it).

**Owns:** `obe_outcome_set`, `obe_outcome`, `obe_course_outcome`, `obe_co_mapping`, `obe_item_tag` (migration 0076).

**Not yet:** indirect attainment from surveys (Feedback & Surveys, P1 item 18), the "finalise" gate that freezes a cycle's figures, gap analysis and actions carried into the next cycle, NBA Criterion 3 and NAAC exports, attainment across a whole batch (all terms) and per PEO.
