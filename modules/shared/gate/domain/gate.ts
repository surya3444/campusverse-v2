// Pure rules for the gate (docs/specs/VISITORS_GATE.md). No I/O.

/** An Indian mobile number as +91XXXXXXXXXX, from what a guard types; null if it isn't one. */
export function mobile(text: string): string | null {
  const d = text.replace(/[\s()-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export type Guardian = { personId: string; phones: string[]; restricted: boolean };
export type Collector = { guardianId: string } | { name: string; relation: string; phone: string };

/**
 * Who may collect a child. A guardian on record who isn't restricted; or someone else, unless
 * their phone belongs to a restricted guardian (the same person typed as "someone else").
 */
export function collectorCheck(
  guardians: Guardian[],
  c: Collector,
): 'ok' | 'collector_restricted' | 'collector_not_guardian' {
  if ('guardianId' in c) {
    const g = guardians.find((x) => x.personId === c.guardianId);
    if (!g) return 'collector_not_guardian';
    return g.restricted ? 'collector_restricted' : 'ok';
  }
  return guardians.some((g) => g.restricted && g.phones.includes(c.phone))
    ? 'collector_restricted'
    : 'ok';
}
