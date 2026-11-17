// Result analysis with no I/O: how a paper went, and a class's top students. Hundredths and
// basis points throughout, so nothing becomes a float (CLAUDE.md: marks use numeric).
import { fromHundredths, hundredths, type Mark } from './results.js';

export type PaperStats = {
  /** Marks or absentees: every student counted against the paper. */
  entered: number;
  absent: number;
  blank: number;
  averageBp: number | null;
  highest: string | null;
  lowest: string | null;
  passed: number;
  passRateBp: number | null;
  grades: Record<string, number>;
};

/** Absent and unfair means count as zero; medical, exempt and not applicable are left out. */
const ZERO = new Set(['AB', 'UFM']);

export function paperStats(
  max: string,
  marks: Mark[],
  passBasisPoints: number,
  grade: (bp: number) => string,
): PaperStats {
  const maxH = hundredths(max) ?? 0;
  const counted: number[] = [];
  let absent = 0;
  let blank = 0;
  for (const m of marks) {
    if (m.code && ZERO.has(m.code)) {
      counted.push(0);
      if (m.code === 'AB') absent++;
    } else if (m.value !== null) {
      const h = hundredths(m.value);
      if (h !== null) counted.push(h);
    } else if (!m.code) blank++;
  }
  const bp = (h: number) => (maxH > 0 ? Math.floor((h * 10_000) / maxH) : 0);
  const grades: Record<string, number> = {};
  for (const h of counted) grades[grade(bp(h))] = (grades[grade(bp(h))] ?? 0) + 1;
  const passed = counted.filter((h) => bp(h) >= passBasisPoints).length;
  const total = counted.reduce((a, b) => a + b, 0);
  return {
    entered: counted.length,
    absent,
    blank,
    averageBp:
      counted.length && maxH > 0 ? Math.floor((total * 10_000) / (counted.length * maxH)) : null,
    highest: counted.length ? fromHundredths(Math.max(...counted)) : null,
    lowest: counted.length ? fromHundredths(Math.min(...counted)) : null,
    passed,
    passRateBp: counted.length ? Math.floor((passed * 10_000) / counted.length) : null,
    grades,
  };
}

/** The top students by overall percentage, among those with every subject counted. */
export function toppers(
  results: { studentId: string; percentBp: number | null; complete: boolean }[],
  limit: number,
): { studentId: string; percentBp: number; rank: number }[] {
  const ranked = results
    .filter(
      (r): r is { studentId: string; percentBp: number; complete: true } =>
        r.complete && r.percentBp !== null,
    )
    .sort((a, b) => b.percentBp - a.percentBp || a.studentId.localeCompare(b.studentId));
  const out: { studentId: string; percentBp: number; rank: number }[] = [];
  ranked.forEach((r, i) => {
    const rank =
      i > 0 && ranked[i - 1]?.percentBp === r.percentBp ? (out[i - 1]?.rank ?? i + 1) : i + 1;
    if (rank <= limit) out.push({ studentId: r.studentId, percentBp: r.percentBp, rank });
  });
  return out;
}
