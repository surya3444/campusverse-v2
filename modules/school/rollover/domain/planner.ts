// Pure section planning: deal a class into sections, balanced, and score the result. No I/O.
// Only size, gender and marks are used; sensitive factors never are, and sections are never ranked by merit.

export type Pupil = { id: string; gender: string | null; scoreBp: number | null };
export type Section = { id: string; capacity: number };
export type Plan = Record<string, string>;

/**
 * Each gender is dealt round-robin by marks (best first), starting with the sections that are
 * smallest so far: every section gets each gender's top, middle and bottom marks, and sizes and
 * gender counts stay within one. Keep-apart pairs are then separated by swapping with a pupil of
 * the same gender in another section.
 */
export function generate(
  pupils: Pupil[],
  sections: Section[],
  keepApart: [string, string][] = [],
): Plan {
  if (sections.length === 0) return {};
  const plan: Plan = {};
  const size = new Map(sections.map((s) => [s.id, 0]));
  const genders = [...new Set(pupils.map((p) => p.gender ?? ''))].sort();
  for (const g of genders) {
    const group = pupils
      .filter((p) => (p.gender ?? '') === g)
      .sort((a, b) => (b.scoreBp ?? -1) - (a.scoreBp ?? -1) || a.id.localeCompare(b.id));
    const order = [...sections].sort((a, b) => (size.get(a.id) ?? 0) - (size.get(b.id) ?? 0));
    group.forEach((p, i) => {
      const s = order[i % order.length];
      if (!s) return;
      plan[p.id] = s.id;
      size.set(s.id, (size.get(s.id) ?? 0) + 1);
    });
  }
  const ordered = [...pupils].sort((a, b) => a.id.localeCompare(b.id));
  for (const [a, b] of keepApart) {
    if (!plan[a] || plan[a] !== plan[b]) continue;
    const pb = pupils.find((p) => p.id === b);
    const swap = ordered.find(
      (q) => q.id !== a && q.id !== b && plan[q.id] !== plan[b] && q.gender === pb?.gender,
    );
    if (swap) [plan[b], plan[swap.id]] = [plan[swap.id] as string, plan[b] as string];
  }
  return plan;
}

export type Balance = {
  sectionId: string;
  size: number;
  capacity: number;
  byGender: Record<string, number>;
  averageBp: number | null;
};

export function balance(pupils: Pupil[], sections: Section[], plan: Plan): Balance[] {
  return sections.map((s) => {
    const mine = pupils.filter((p) => plan[p.id] === s.id);
    const scored = mine.filter((p) => p.scoreBp !== null);
    const byGender: Record<string, number> = {};
    for (const p of mine)
      byGender[p.gender ?? 'not_stated'] = (byGender[p.gender ?? 'not_stated'] ?? 0) + 1;
    return {
      sectionId: s.id,
      size: mine.length,
      capacity: s.capacity,
      byGender,
      averageBp: scored.length
        ? Math.floor(scored.reduce((a, p) => a + (p.scoreBp ?? 0), 0) / scored.length)
        : null,
    };
  });
}

export type Problem =
  | { code: 'over_capacity'; sectionId: string }
  | { code: 'kept_together'; pair: [string, string] }
  | { code: 'unplaced'; pupilId: string };

export function problems(
  pupils: Pupil[],
  sections: Section[],
  plan: Plan,
  keepApart: [string, string][] = [],
): Problem[] {
  const out: Problem[] = [];
  for (const b of balance(pupils, sections, plan))
    if (b.size > b.capacity) out.push({ code: 'over_capacity', sectionId: b.sectionId });
  for (const pair of keepApart)
    if (plan[pair[0]] && plan[pair[0]] === plan[pair[1]]) out.push({ code: 'kept_together', pair });
  for (const p of pupils)
    if (!plan[p.id] || !sections.some((s) => s.id === plan[p.id]))
      out.push({ code: 'unplaced', pupilId: p.id });
  return out;
}
