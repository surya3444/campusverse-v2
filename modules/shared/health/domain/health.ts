// Health Connect rules (rule book §13.9, §12.4 decision 13, §16.5). Pure: no database or HTTP.

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/** What the health vault holds for a student. Sealed as one value. */
export type Vault = {
  bloodGroup: BloodGroup | null;
  allergies: string;
  conditions: string;
  medicines: string;
  /** What a first responder must know, in a line or two. */
  responderNotes: string;
};

export const EMPTY_VAULT: Vault = {
  bloodGroup: null,
  allergies: '',
  conditions: '',
  medicines: '',
  responderNotes: '',
};

const clip = (s: string, n: number) => s.trim().slice(0, n);

export function cleanVault(v: Vault): Vault {
  return {
    bloodGroup: v.bloodGroup && BLOOD_GROUPS.includes(v.bloodGroup) ? v.bloodGroup : null,
    allergies: clip(v.allergies, 1000),
    conditions: clip(v.conditions, 2000),
    medicines: clip(v.medicines, 1000),
    responderNotes: clip(v.responderNotes, 500),
  };
}

/** Flags kept in clear for totals; the details stay sealed. */
export const vaultFlags = (v: Vault) => ({
  hasAllergies: v.allergies.trim() !== '',
  hasConditions: v.conditions.trim() !== '',
  bloodGroupKnown: v.bloodGroup !== null,
});

/**
 * Break-glass shows a responder only what saves a life: blood group, allergies and the
 * responder notes. Conditions and medicines stay with the medical role (rule book §16.5 step 3).
 */
export const emergencyView = (v: Vault) => ({
  bloodGroup: v.bloodGroup,
  allergies: v.allergies,
  responderNotes: v.responderNotes,
});

export const BREAK_GLASS_MINUTES = 60;

export const VISIT_OUTCOMES = ['back_to_class', 'rested', 'sent_home', 'referred'] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

/** Notes of a sick-room visit. Sealed. */
export type VisitNotes = { complaint: string; care: string };

/**
 * Totals shown to management never name anyone, and a count below this is shown as "fewer
 * than 5" so a small class can't be read off a total.
 */
export const SMALL_COUNT = 5;
export const shownCount = (n: number): number | null => (n > 0 && n < SMALL_COUNT ? null : n);
