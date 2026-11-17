// Breach and incident clocks. Pure; no I/O. The deadlines follow CERT-In's directions (report
// within 6 hours) and the DPDP rules as drafted (Board and affected people within 72 hours);
// both need legal confirmation before the pilot.

export const CERTIN_HOURS = 6;
export const BOARD_HOURS = 72;

export type IncidentSteps = {
  discoveredAt: string;
  personalData: boolean;
  certinReportedAt: string | null;
  boardNotifiedAt: string | null;
  schoolsNotifiedAt: string | null;
};

export type Clock = { due: string; doneAt: string | null; overdue: boolean };

const plusHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3600e3).toISOString();

/** What is due by when, and what is late. Board and schools apply only when personal data is involved. */
export function incidentClocks(s: IncidentSteps, now: Date = new Date()) {
  const clock = (hours: number, doneAt: string | null): Clock => {
    const due = plusHours(s.discoveredAt, hours);
    return { due, doneAt, overdue: !doneAt && now.getTime() > Date.parse(due) };
  };
  return {
    certin: clock(CERTIN_HOURS, s.certinReportedAt),
    board: s.personalData ? clock(BOARD_HOURS, s.boardNotifiedAt) : null,
    schools: s.personalData ? clock(BOARD_HOURS, s.schoolsNotifiedAt) : null,
  };
}
