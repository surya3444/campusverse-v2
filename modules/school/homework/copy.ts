// Message text sent to guardians about homework (English; regional versions with the app's).
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const COPY = {
  en: {
    setTitle: (subject: string) => `Homework: ${subject}`,
    setBody: (name: string, title: string, dueOn: string) =>
      `${name}: ${title}. Due ${day(dueOn)}.`,
    movedTitle: (subject: string) => `Homework date changed: ${subject}`,
    movedBody: (name: string, title: string, dueOn: string) =>
      `${name}: ${title} is now due ${day(dueOn)}.`,
  },
} as const;
