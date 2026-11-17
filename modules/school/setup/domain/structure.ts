// Turns the wizard's answers into a concrete structure. Pure: no database, no framework.
import {
  CBSE_CLASSES,
  CBSE_DEFAULT_SUBJECTS,
  SUBJECTS,
  type BoardCode,
  type SubjectCode,
} from '@campusverse/rules';

export type StructureInput = {
  board: BoardCode;
  yearLabel: string; // '2026-27'
  starts: string; // 'YYYY-MM-DD'
  ends: string; // last day, inclusive
  classes: { code: string; sections: number; capacity: number }[];
  /** Optional override of the default subjects for a class. */
  subjects?: Record<string, SubjectCode[]> | undefined;
};

export type StructurePlan = {
  year: { label: string; starts: string; endsExclusive: string };
  classes: {
    code: string;
    name: string;
    sequence: number;
    sections: { name: string; capacity: number }[];
    subjects: { code: SubjectCode; name: string }[];
  }[];
  totals: { classes: number; sections: number; seats: number };
};

export type StructureProblem =
  | { code: 'bad_year_label' }
  | { code: 'bad_dates' }
  | { code: 'unknown_class'; class: string }
  | { code: 'duplicate_class'; class: string }
  | { code: 'bad_sections'; class: string }
  | { code: 'bad_capacity'; class: string }
  | { code: 'no_classes' };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function planStructure(
  input: StructureInput,
): { plan: StructurePlan } | { problems: StructureProblem[] } {
  const problems: StructureProblem[] = [];
  if (!/^\d{4}-\d{2}$/.test(input.yearLabel)) problems.push({ code: 'bad_year_label' });
  const datesOk =
    ISO.test(input.starts) &&
    ISO.test(input.ends) &&
    !Number.isNaN(Date.parse(input.starts)) &&
    !Number.isNaN(Date.parse(input.ends)) &&
    input.starts < input.ends;
  if (!datesOk) problems.push({ code: 'bad_dates' });
  if (input.classes.length === 0) problems.push({ code: 'no_classes' });

  const known = new Map(CBSE_CLASSES.map((c) => [c.code, c]));
  const seen = new Set<string>();
  for (const c of input.classes) {
    if (!known.has(c.code)) problems.push({ code: 'unknown_class', class: c.code });
    if (seen.has(c.code)) problems.push({ code: 'duplicate_class', class: c.code });
    seen.add(c.code);
    if (!Number.isInteger(c.sections) || c.sections < 1 || c.sections > SECTION_NAMES.length) {
      problems.push({ code: 'bad_sections', class: c.code });
    }
    if (!Number.isInteger(c.capacity) || c.capacity < 1 || c.capacity > 80) {
      problems.push({ code: 'bad_capacity', class: c.code });
    }
  }
  if (problems.length > 0) return { problems };

  const classes = input.classes
    .flatMap((c) => {
      const def = known.get(c.code);
      if (!def) return []; // unreachable: unknown classes were reported above
      const subjects = input.subjects?.[c.code] ?? CBSE_DEFAULT_SUBJECTS.byClass[c.code] ?? [];
      return [
        {
          code: def.code,
          name: def.name,
          sequence: def.sequence,
          sections: Array.from({ length: c.sections }, (_, i) => ({
            name: SECTION_NAMES.charAt(i),
            capacity: c.capacity,
          })),
          subjects: subjects.map((s) => ({ code: s, name: SUBJECTS[s] })),
        },
      ];
    })
    .sort((a, b) => a.sequence - b.sequence);

  return {
    plan: {
      year: { label: input.yearLabel, starts: input.starts, endsExclusive: nextDay(input.ends) },
      classes,
      totals: {
        classes: classes.length,
        sections: classes.reduce((n, c) => n + c.sections.length, 0),
        seats: classes.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.capacity, 0), 0),
      },
    },
  };
}
