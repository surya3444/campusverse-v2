// Generating a timetable (decision 9): a search over every section's missing periods per week,
// under rules the school sets. Hard rules are never broken: a section or teacher in one place at
// a time, days a teacher is off, a teacher's most periods a day and most in a row, how often a
// subject comes in a day, double periods kept together (never across a break). Soft wishes
// (morning or afternoon subjects, a subject spread over the week, a teacher's day not crowded)
// order the choices. Backtracking with the most constrained subject first and identical lessons
// taken in one order (no permutations of the same thing twice), restarted with new seeds; if no
// complete timetable turns up, the fullest one found is offered with what didn't fit. Pure.

export type SubjectRule = {
  /** Double periods a week (labs, practicals): two class periods in a row, no break between. */
  doubles?: number | undefined;
  time?: 'any' | 'morning' | 'afternoon' | undefined;
  /** Overrides the school's "times a day" for this subject. */
  maxPerDay?: number | undefined;
  /** The lesson needs one of these rooms ("Science lab"); a free one is given. */
  rooms?: string[] | undefined;
  /** Class periods the subject never takes ("Period 1" = 1): PE not first, Maths not last. */
  avoidPeriods?: number[] | undefined;
  /** ISO weekdays the subject may be taught on (empty or missing: any day). */
  days?: number[] | undefined;
  /** Wish: the same period every day it comes (routine for young classes). */
  samePeriod?: boolean | undefined;
};
export type TeacherRule = {
  /** ISO weekdays the teacher isn't in. */
  offDays?: number[] | undefined;
  /** Class periods ("Period 1" = 1) the teacher isn't available, every day. */
  offPeriods?: number[] | undefined;
  /** Particular times the teacher isn't available: "weekday:period", such as "1:1" (Monday, period 1). */
  offCells?: string[] | undefined;
  maxPerDay?: number | undefined;
  /** Most class periods in the whole week. */
  maxPerWeek?: number | undefined;
};
export type Rules = {
  /** Fill the empty cells, or rebuild every section lesson (groups stay). */
  mode: 'fill' | 'rebuild';
  /** How many times a subject comes in a section's day (a double counts once). */
  maxSamePerDay: number;
  teacherMaxPerDay: number;
  teacherMaxInARow: number;
  subjects: Record<string, SubjectRule>;
  teachers: Record<string, TeacherRule>;
  /** Wish: the class teacher takes each section's first period (attendance, the day's start). */
  classTeacherFirst?: boolean | undefined;
  /** Wish: teachers' lessons together (fewer free gaps) or spread evenly over the day. */
  teacherDay?: 'balanced' | 'compact' | undefined;
  /** Search effort: quick (seconds), standard, thorough (longer, for tight schools). */
  effort?: 'quick' | 'standard' | 'thorough' | undefined;
  /** The arrangement to start from; another number gives another timetable. */
  seed?: number | undefined;
};
export const DEFAULT_RULES: Rules = {
  mode: 'fill',
  maxSamePerDay: 1,
  teacherMaxPerDay: 6,
  teacherMaxInARow: 3,
  subjects: {},
  teachers: {},
  classTeacherFirst: false,
  teacherDay: 'balanced',
  effort: 'standard',
  seed: 1,
};
/** Lessons tried per attempt, attempts, and time, by effort. */
export const EFFORT = {
  quick: { stepsPerTry: 8_000, tries: 4, timeMs: 5_000 },
  standard: { stepsPerTry: 20_000, tries: 12, timeMs: 20_000 },
  thorough: { stepsPerTry: 60_000, tries: 30, timeMs: 60_000 },
} as const;
type Wish = { met: number; of: number };

export type Demand = {
  sectionId: string;
  subjectId: string;
  teacherPersonId: string | null;
  count: number;
};
export type Cell = { weekday: number; period: number };
/** A lesson already in the draft that stays: it takes its cells and counts toward the rules. */
export type Fixed = Cell & {
  sectionIds: string[];
  subjectId: string;
  teacherPersonId: string | null;
  room?: string | null | undefined;
};
export type Placed = Omit<Demand, 'count'> & Cell & { room: string | null };
export type Generated = {
  placed: Placed[];
  short: { sectionId: string; subjectId: string; missing: number }[];
  /** Every period placed with every hard rule kept. */
  complete: boolean;
  /** Lessons placed in their subject's chosen half of the day, of those with a choice. */
  timeWish: Wish;
  /** Section-days whose first period went to the class teacher, when asked for. */
  classTeacherWish?: Wish;
  /** Lessons of "same period" subjects at their most used period, when asked for. */
  samePeriodWish?: Wish;
  /** Lessons tried while searching. */
  steps: number;
};

type Unit = { demand: number; d: Demand; size: 1 | 2 };
type State = {
  sec: Set<string>;
  teacher: Set<string>;
  teacherDay: Map<string, number>;
  subjectDay: Map<string, number>;
  sectionDay: Map<string, number>;
  room: Set<string>;
  teacherWeek: Map<string, number>;
  /** Periods used per section and subject ("sec:subj" → bell row → count). */
  subjectPeriods: Map<string, Map<number, number>>;
};

/** A small seeded random number generator (mulberry32), so a run can be repeated. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

export function generate(input: {
  demands: readonly Demand[];
  days: readonly number[];
  /** Class periods only, in bell order (bell row numbers; a break between makes a gap). */
  periods: readonly number[];
  fixed: readonly Fixed[];
  rules: Rules;
  seed?: number;
  /** Each section's class teacher, for the "class teacher first" wish. */
  classTeachers?: Readonly<Record<string, string | null>>;
  /** Search effort: lessons tried per attempt, and attempts (default: from rules.effort). */
  stepsPerTry?: number;
  tries?: number;
  /** Stop searching after this long (the fullest result so far stands). */
  timeMs?: number;
}): Generated {
  const { rules, days, periods } = input;
  const demands = input.demands.filter((d) => d.count > 0);
  const half = Math.ceil(periods.length / 2);
  const index = new Map(periods.map((p, i) => [p, i]));
  const next = new Map(periods.map((p, i) => [p, periods[i + 1] === p + 1 ? p + 1 : null]));
  /** The bell rows a lesson takes from a cell: one, or two in a row (empty if no second). */
  const span = (c: Cell, size: 1 | 2): number[] => {
    if (size === 1) return [c.period];
    const second = next.get(c.period);
    return second ? [c.period, second] : [];
  };
  const maxSame = (subjectId: string) =>
    rules.subjects[subjectId]?.maxPerDay ?? rules.maxSamePerDay;
  const teacherMax = (t: string) => rules.teachers[t]?.maxPerDay ?? rules.teacherMaxPerDay;
  const off = (t: string, d: number) => !!rules.teachers[t]?.offDays?.includes(d);
  /** "Period n" of a bell row, counting class periods only. */
  const ordinal = (p: number) => (index.get(p) ?? -1) + 1;
  /** Not available then: every day in that period, or that day and period in particular. */
  const offPeriod = (t: string, p: number, weekday?: number) =>
    !!rules.teachers[t]?.offPeriods?.includes(ordinal(p)) ||
    (weekday !== undefined && !!rules.teachers[t]?.offCells?.includes(`${weekday}:${ordinal(p)}`));
  const roomsOf = (subjectId: string) => rules.subjects[subjectId]?.rooms ?? [];
  const rk = (room: string, weekday: number, p: number) => `${room.toLowerCase()}:${weekday}:${p}`;
  /** A free room the lesson needs: undefined if it needs none, null if none is free. */
  const roomFor = (s: State, u: Unit, c: Cell): string | null | undefined => {
    const rooms = roomsOf(u.d.subjectId);
    if (rooms.length === 0) return undefined;
    const ps = span(c, u.size);
    return rooms.find((r) => ps.every((p) => !s.room.has(rk(r, c.weekday, p)))) ?? null;
  };

  const bump = (s: State, key: string, period: number, n: number) => {
    const m = s.subjectPeriods.get(key) ?? new Map<number, number>();
    m.set(period, (m.get(period) ?? 0) + n);
    s.subjectPeriods.set(key, m);
  };
  const subjectAvoids = (subjectId: string, p: number) =>
    !!rules.subjects[subjectId]?.avoidPeriods?.includes(ordinal(p));
  const subjectDayOk = (subjectId: string, weekday: number) => {
    const allowed = rules.subjects[subjectId]?.days;
    return !allowed || allowed.length === 0 || allowed.includes(weekday);
  };
  const first = periods[0];
  const classTeacher = (sectionId: string) => input.classTeachers?.[sectionId] ?? null;

  // Lessons to place: doubles first within a subject, then singles.
  const units: Unit[] = demands.flatMap((d, i) => {
    const doubles = Math.min(rules.subjects[d.subjectId]?.doubles ?? 0, Math.floor(d.count / 2));
    return [
      ...Array.from({ length: doubles }, () => ({ demand: i, d, size: 2 as const })),
      ...Array.from({ length: d.count - doubles * 2 }, () => ({ demand: i, d, size: 1 as const })),
    ];
  });
  // Every cell in a fixed order: identical lessons of a subject take increasing cells.
  const cells: Cell[] = days.flatMap((weekday) => periods.map((period) => ({ weekday, period })));
  const order = (c: Cell) => days.indexOf(c.weekday) * periods.length + (index.get(c.period) ?? 0);

  const fresh = (): State => {
    const s: State = {
      sec: new Set(),
      teacher: new Set(),
      teacherDay: new Map(),
      subjectDay: new Map(),
      sectionDay: new Map(),
      room: new Set(),
      teacherWeek: new Map(),
      subjectPeriods: new Map(),
    };
    for (const f of input.fixed) {
      for (const id of f.sectionIds) {
        s.sec.add(`${id}:${f.weekday}:${f.period}`);
        add(s.subjectDay, `${id}:${f.subjectId}:${f.weekday}`, 1);
        add(s.sectionDay, `${id}:${f.weekday}`, 1);
        bump(s, `${id}:${f.subjectId}`, f.period, 1);
      }
      if (f.room) s.room.add(rk(f.room, f.weekday, f.period));
      if (f.teacherPersonId) {
        s.teacher.add(`${f.teacherPersonId}:${f.weekday}:${f.period}`);
        add(s.teacherDay, `${f.teacherPersonId}:${f.weekday}`, 1);
        add(s.teacherWeek, f.teacherPersonId, 1);
      }
    }
    return s;
  };

  /** Consecutive class periods the teacher would teach around these cells. */
  const run = (s: State, t: string, weekday: number, taken: number[]) => {
    const busy = (p: number) => taken.includes(p) || s.teacher.has(`${t}:${weekday}:${p}`);
    let n = taken.length;
    for (let p = Math.min(...taken) - 1; index.has(p) && busy(p); p--) n++;
    for (let p = Math.max(...taken) + 1; index.has(p) && busy(p); p++) n++;
    return n;
  };

  const fits = (s: State, u: Unit, c: Cell): boolean => {
    const d = u.d;
    const ps = span(c, u.size);
    if (ps.length !== u.size) return false;
    for (const p of ps) if (s.sec.has(`${d.sectionId}:${c.weekday}:${p}`)) return false;
    if (!subjectDayOk(d.subjectId, c.weekday)) return false;
    if (ps.some((p) => subjectAvoids(d.subjectId, p))) return false;
    if (
      (s.subjectDay.get(`${d.sectionId}:${d.subjectId}:${c.weekday}`) ?? 0) >= maxSame(d.subjectId)
    )
      return false;
    const t = d.teacherPersonId;
    if (t) {
      if (off(t, c.weekday)) return false;
      for (const p of ps)
        if (s.teacher.has(`${t}:${c.weekday}:${p}`) || offPeriod(t, p, c.weekday)) return false;
      if ((s.teacherDay.get(`${t}:${c.weekday}`) ?? 0) + ps.length > teacherMax(t)) return false;
      const week = rules.teachers[t]?.maxPerWeek;
      if (week !== undefined && (s.teacherWeek.get(t) ?? 0) + ps.length > week) return false;
      if (run(s, t, c.weekday, ps) > rules.teacherMaxInARow) return false;
    }
    return roomFor(s, u, c) !== null;
  };

  const wish = (d: { subjectId: string }, c: Cell) => {
    const time = rules.subjects[d.subjectId]?.time;
    if (!time || time === 'any') return null;
    return (index.get(c.period) ?? 0) < half === (time === 'morning');
  };

  const cost = (s: State, u: Unit, c: Cell, rand: () => number) => {
    const d = u.d;
    return (
      // Each period of the lesson (both halves of a double) outside its time of day.
      span(c, u.size).filter((period) => wish(d, { weekday: c.weekday, period }) === false).length *
        3 +
      (s.subjectDay.get(`${d.sectionId}:${d.subjectId}:${c.weekday}`) ?? 0) * 4 +
      (s.sectionDay.get(`${d.sectionId}:${c.weekday}`) ?? 0) * 0.3 +
      teacherCost(s, d.teacherPersonId, c, span(c, u.size)) +
      samePeriodCost(s, d, c) +
      firstPeriodCost(d, c, span(c, u.size)) +
      rand() * 0.5
    );
  };
  /** Balanced: a teacher's busier days cost more. Compact: next to their other lessons is cheaper. */
  function teacherCost(s: State, t: string | null, c: Cell, ps: number[]) {
    if (!t) return 0;
    const day = s.teacherDay.get(`${t}:${c.weekday}`) ?? 0;
    if (rules.teacherDay !== 'compact') return day * 0.3;
    if (day === 0) return 0.6;
    const near = ps.some((p) =>
      [periods[(index.get(p) ?? 0) - 1], periods[(index.get(p) ?? 0) + 1]].some(
        (q) => q !== undefined && s.teacher.has(`${t}:${c.weekday}:${q}`),
      ),
    );
    return near ? -0.8 : 0.4;
  }
  /** "Same period" subjects: away from the period they already use most costs more. */
  function samePeriodCost(s: State, d: Demand, c: Cell) {
    if (!rules.subjects[d.subjectId]?.samePeriod) return 0;
    const used = s.subjectPeriods.get(`${d.sectionId}:${d.subjectId}`);
    if (!used || used.size === 0) return 0;
    const top = Math.max(...used.values());
    return (used.get(c.period) ?? 0) === top ? -1 : 2;
  }
  /** The class teacher in a section's first period; anyone else there costs a little. */
  function firstPeriodCost(d: Demand, c: Cell, ps: number[]) {
    if (!rules.classTeacherFirst || first === undefined || !ps.includes(first)) return 0;
    const ct = classTeacher(d.sectionId);
    if (!ct) return 0;
    return d.teacherPersonId === ct ? -3 : 2;
  }

  const apply = (s: State, u: Unit, c: Cell, sign: 1 | -1, room: string | null) => {
    const d = u.d;
    const ps = span(c, u.size);
    for (const p of ps) {
      if (room) {
        if (sign > 0) s.room.add(rk(room, c.weekday, p));
        else s.room.delete(rk(room, c.weekday, p));
      }
      const k = `${d.sectionId}:${c.weekday}:${p}`;
      if (sign > 0) s.sec.add(k);
      else s.sec.delete(k);
      if (d.teacherPersonId) {
        const tk = `${d.teacherPersonId}:${c.weekday}:${p}`;
        if (sign > 0) s.teacher.add(tk);
        else s.teacher.delete(tk);
      }
    }
    add(s.subjectDay, `${d.sectionId}:${d.subjectId}:${c.weekday}`, sign);
    add(s.sectionDay, `${d.sectionId}:${c.weekday}`, sign * ps.length);
    for (const p of ps) bump(s, `${d.sectionId}:${d.subjectId}`, p, sign);
    if (d.teacherPersonId) {
      add(s.teacherDay, `${d.teacherPersonId}:${c.weekday}`, sign * ps.length);
      add(s.teacherWeek, d.teacherPersonId, sign * ps.length);
    }
  };

  // Groups of identical lessons (same subject, section, size): the search picks a group.
  const groups: (Unit & { left: number; after: number })[] = [];
  for (const u of units) {
    const g = groups.find((x) => x.demand === u.demand && x.size === u.size);
    if (g) g.left++;
    else groups.push({ ...u, left: 1, after: -1 });
  }

  type Move = { u: Unit; c: Cell; room: string | null };
  const periodsIn = (placed: { u: Unit }[]) => placed.reduce((n, p) => n + p.u.size, 0);
  const result = (placed: Move[], steps: number): Generated => {
    const count = new Map<number, number>();
    for (const p of placed) count.set(p.u.demand, (count.get(p.u.demand) ?? 0) + p.u.size);
    const out: Placed[] = placed.flatMap(({ u, c, room }) => {
      const d = u.d;
      const base = {
        sectionId: d.sectionId,
        subjectId: d.subjectId,
        teacherPersonId: d.teacherPersonId,
        room,
      };
      return span(c, u.size).map((period) => ({ ...base, weekday: c.weekday, period }));
    });
    const short = demands
      .map((d, i) => ({
        sectionId: d.sectionId,
        subjectId: d.subjectId,
        missing: d.count - (count.get(i) ?? 0),
      }))
      .filter((x) => x.missing > 0);
    const wishes = out.map((p) => wish(p, p)).filter((w) => w !== null);
    const all = [
      ...out.map((p) => ({ ...p, sectionIds: [p.sectionId] })),
      ...input.fixed.map((f) => ({ ...f, room: f.room ?? null })),
    ];
    return {
      placed: out,
      short,
      complete: short.length === 0,
      timeWish: { met: wishes.filter(Boolean).length, of: wishes.length },
      ...(rules.classTeacherFirst ? { classTeacherWish: firstPeriodWish(all) } : {}),
      ...(Object.values(rules.subjects).some((x) => x.samePeriod)
        ? { samePeriodWish: samePeriodWish(all) }
        : {}),
      steps,
    };
  };

  type Lesson = Cell & { sectionIds: string[]; subjectId: string; teacherPersonId: string | null };
  /** Of the section-days with a class teacher, how many start with them. */
  function firstPeriodWish(all: Lesson[]): Wish {
    let met = 0;
    let of = 0;
    const sections = new Set(demands.map((d) => d.sectionId));
    for (const sectionId of sections) {
      const ct = classTeacher(sectionId);
      if (!ct) continue;
      for (const weekday of days) {
        of++;
        const l = all.find(
          (x) => x.weekday === weekday && x.period === first && x.sectionIds.includes(sectionId),
        );
        if (l?.teacherPersonId === ct) met++;
      }
    }
    return { met, of };
  }
  /** Lessons of "same period" subjects at their section's most used period for them. */
  function samePeriodWish(all: Lesson[]): Wish {
    const by = new Map<string, Map<number, number>>();
    for (const l of all) {
      if (!rules.subjects[l.subjectId]?.samePeriod) continue;
      for (const sec of l.sectionIds) {
        const k = `${sec}:${l.subjectId}`;
        const m = by.get(k) ?? new Map<number, number>();
        m.set(l.period, (m.get(l.period) ?? 0) + 1);
        by.set(k, m);
      }
    }
    let met = 0;
    let of = 0;
    for (const m of by.values()) {
      met += Math.max(...m.values());
      of += [...m.values()].reduce((a, b) => a + b, 0);
    }
    return { met, of };
  }

  /** One depth-first search: complete, or the fullest assignment seen when the effort runs out. */
  const search = (rand: () => number, budget: number) => {
    const s = fresh();
    const gs = groups.map((g) => ({ ...g }));
    const path: (Move & { g: (typeof gs)[number]; prevAfter: number; options: Cell[] })[] = [];
    let best: Move[] = [];
    let steps = 0;
    // Options per group, recomputed only when a move touched its section or teacher.
    const cache = new Map<(typeof gs)[number], Cell[]>();
    const touch = (u: Unit, room: string | null) => {
      const d = u.d;
      const r = room?.toLowerCase();
      for (const g of gs) {
        const o = g.d;
        if (
          o.sectionId === d.sectionId ||
          (d.teacherPersonId !== null && o.teacherPersonId === d.teacherPersonId) ||
          (r && roomsOf(o.subjectId).some((x) => x.toLowerCase() === r))
        )
          cache.delete(g);
      }
    };
    const optionsFor = (g: (typeof gs)[number]) => {
      let o = cache.get(g);
      if (!o) {
        const u: Unit = { demand: g.demand, d: g.d, size: g.size };
        o = cells.filter((c) => order(c) > g.after && fits(s, u, c));
        cache.set(g, o);
      }
      return o;
    };
    /** The most constrained group next; null when one can no longer be finished. */
    const choose = () => {
      let pick: { g: (typeof gs)[number]; options: Cell[] } | null = null;
      let slack = Infinity;
      for (const g of gs) {
        if (g.left === 0) continue;
        const options = optionsFor(g);
        const sl = options.length - g.left;
        if (sl < 0) return null;
        if (sl < slack) {
          slack = sl;
          pick = { g, options };
        }
      }
      return pick ?? 'done';
    };
    const expand = () => {
      const pick = choose();
      if (pick === 'done') return 'done' as const;
      if (!pick) return 'dead' as const;
      const u: Unit = { demand: pick.g.demand, d: pick.g.d, size: pick.g.size };
      const ranked = pick.options
        .map((c) => ({ c, k: cost(s, u, c, rand) }))
        .sort((a, b) => a.k - b.k)
        .map((x) => x.c);
      const [first, ...rest] = ranked;
      if (!first) return 'dead' as const;
      path.push({ u, c: first, room: null, g: pick.g, prevAfter: pick.g.after, options: rest });
      return 'go' as const;
    };
    const take = (top: (typeof path)[number]) => {
      top.room = roomFor(s, top.u, top.c) ?? null;
      apply(s, top.u, top.c, 1, top.room);
      top.g.left--;
      top.g.after = order(top.c);
      touch(top.u, top.room);
      steps++;
    };
    const undo = (top: (typeof path)[number]) => {
      apply(s, top.u, top.c, -1, top.room);
      top.g.left++;
      top.g.after = top.prevAfter;
      touch(top.u, top.room);
    };
    let state = expand();
    while (state === 'go' && steps < budget) {
      const top = path.at(-1);
      if (!top) break;
      take(top);
      if (periodsIn(path) > periodsIn(best)) best = path.map(({ u, c, room }) => ({ u, c, room }));
      state = expand();
      while (state === 'dead' && path.length > 0) {
        // Back up to the latest choice with another option.
        const last = path.at(-1);
        if (!last) break;
        undo(last);
        const alt = last.options.shift();
        if (alt) {
          last.c = alt;
          state = 'go';
        } else {
          path.pop();
        }
      }
    }
    if (state === 'done') best = path.map(({ u, c, room }) => ({ u, c, room }));
    return { placed: best, done: state === 'done', steps };
  };

  /** Without backtracking: each lesson at its best cell, or listed as not fitting. */
  const greedy = (rand: () => number) => {
    const s = fresh();
    const gs = groups.map((g) => ({ ...g }));
    const placed: Move[] = [];
    for (;;) {
      let pick: { g: (typeof gs)[number]; options: Cell[] } | null = null;
      for (const g of gs) {
        if (g.left === 0) continue;
        const u: Unit = { demand: g.demand, d: g.d, size: g.size };
        const options = cells.filter((c) => fits(s, u, c));
        if (options.length === 0) {
          g.left = 0;
          continue;
        }
        if (!pick || options.length - g.left < pick.options.length - pick.g.left)
          pick = { g, options };
      }
      if (!pick) break;
      const u: Unit = { demand: pick.g.demand, d: pick.g.d, size: pick.g.size };
      const c = pick.options
        .map((x) => ({ x, k: cost(s, u, x, rand) }))
        .sort((a, b) => a.k - b.k)[0]?.x;
      if (!c) break;
      const room = roomFor(s, u, c) ?? null;
      apply(s, u, c, 1, room);
      pick.g.left--;
      placed.push({ u, c, room });
    }
    return placed;
  };

  // A teacher with more periods than their week can hold makes a complete timetable impossible:
  // skip straight to the fullest one.
  const fixedState = fresh();
  const overloaded = [...new Set(demands.map((d) => d.teacherPersonId))].some((t) => {
    if (!t) return false;
    const need = demands.filter((d) => d.teacherPersonId === t).reduce((n, d) => n + d.count, 0);
    const room = days
      .filter((d) => !off(t, d))
      .reduce((n, d) => {
        const free = periods.filter(
          (p) => !fixedState.teacher.has(`${t}:${d}:${p}`) && !offPeriod(t, p, d),
        ).length;
        const used = fixedState.teacherDay.get(`${t}:${d}`) ?? 0;
        return n + Math.max(0, Math.min(free, teacherMax(t) - used));
      }, 0);
    const week = rules.teachers[t]?.maxPerWeek;
    const weekLeft = week === undefined ? Infinity : week - (fixedState.teacherWeek.get(t) ?? 0);
    return need > Math.min(room, weekLeft);
  });

  // Rooms booked beyond their week: subjects limited to a set of rooms need more lessons than
  // those rooms have free cells.
  const roomOverbooked = [
    ...new Set(
      demands.map((d) =>
        roomsOf(d.subjectId)
          .map((r) => r.toLowerCase())
          .sort()
          .join('|'),
      ),
    ),
  ]
    .filter(Boolean)
    .some((key) => {
      const set = key.split('|');
      const need = demands
        .filter((d) => {
          const rs = roomsOf(d.subjectId).map((r) => r.toLowerCase());
          return rs.length > 0 && rs.every((r) => set.includes(r));
        })
        .reduce((n, d) => n + d.count, 0);
      const free = set.reduce(
        (n, r) => n + cells.filter((c) => !fixedState.room.has(rk(r, c.weekday, c.period))).length,
        0,
      );
      return need > free;
    });

  let best: { placed: Move[]; done: boolean } = { placed: [], done: false };
  let steps = 0;
  const effort = EFFORT[rules.effort ?? 'standard'];
  const seed = input.seed ?? rules.seed ?? 1;
  const tries = overloaded || roomOverbooked ? 0 : (input.tries ?? effort.tries);
  const until = Date.now() + (input.timeMs ?? effort.timeMs);
  for (let i = 0; i < tries && !best.done && Date.now() < until; i++) {
    const r = search(random(seed + i), input.stepsPerTry ?? effort.stepsPerTry);
    steps += r.steps;
    if (r.done || periodsIn(r.placed) > periodsIn(best.placed)) best = r;
  }
  if (!best.done) {
    const g = greedy(random(seed));
    if (periodsIn(g) > periodsIn(best.placed)) best = { placed: g, done: false };
  }
  return result(best.placed, steps);
}
