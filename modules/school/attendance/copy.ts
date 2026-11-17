// Message text sent to guardians. Regional languages arrive with the parent app (Milestone 10).
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const COPY = {
  en: {
    absenceTitle: 'Absent today',
    absenceBody: (name: string, onDate: string) =>
      `${name} was marked absent on ${shortDate(onDate)}. If this is wrong, please contact the class teacher.`,
    correctionTitle: 'Attendance corrected',
    correctionBody: (name: string, onDate: string) =>
      `Correction: ${name} was not absent on ${shortDate(onDate)}. Please ignore the earlier message.`,
    shortageTitle: 'Low attendance',
    shortageBody: (name: string, percent: string, minimum: string) =>
      `${name}'s attendance this year is ${percent}%. The board requires ${minimum}% to sit the exams. Please contact the school.`,
    holidayTitle: 'School holiday',
    holidayBody: (name: string, onDate: string) =>
      `School is closed on ${shortDate(onDate)} (${name}).`,
  },
} as const;
