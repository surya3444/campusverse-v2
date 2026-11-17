// User-facing message text. English only until the language files arrive with packages/ui.
export const COPY = {
  en: {
    consentRecordedTitle: 'Consent recorded',
    consentRecordedBody: (purpose: string, decision: string) =>
      `Your choice for "${purpose.replaceAll('_', ' ')}" is recorded as ${decision}.`,
  },
} as const;
