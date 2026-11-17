// User-facing message text for setup. English only until per-language versions arrive.
export const COPY = {
  en: {
    inviteTitle: (school: string) => `Welcome to ${school} on Campusverse`,
    inviteStaffBody: (school: string) =>
      `${school} has added you as staff. Open the Campusverse app and sign in with this phone number.`,
    inviteGuardianBody: (school: string) =>
      `${school} now uses Campusverse for attendance, notices and fees. Open the app and sign in with this phone number.`,
  },
} as const;
