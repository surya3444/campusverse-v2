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

// ---------------------------------------------------------------------------------------------
// Medicines and stock (rule book §13.9 Medicines & Stock)
// ---------------------------------------------------------------------------------------------

/** A medicine is flagged when a batch expires within this many days. */
export const EXPIRY_WARNING_DAYS = 30;

export type Batch = { id: string; expiresOn: string; remaining: number };

/**
 * Takes `quantity` from the batches, earliest expiry first, skipping expired ones (dates as
 * YYYY-MM-DD, `today` included as usable). Null when there isn't enough usable stock.
 */
export function takeFromBatches(
  batches: Batch[],
  quantity: number,
  today: string,
): { batchId: string; quantity: number }[] | null {
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  const usable = batches
    .filter((b) => b.remaining > 0 && b.expiresOn >= today)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const takes: { batchId: string; quantity: number }[] = [];
  let left = quantity;
  for (const b of usable) {
    if (left === 0) break;
    const n = Math.min(left, b.remaining);
    takes.push({ batchId: b.id, quantity: n });
    left -= n;
  }
  return left === 0 ? takes : null;
}

// ---------------------------------------------------------------------------------------------
// Emergencies (rule book §13.9 Emergency, §16.5 steps 3–6)
// ---------------------------------------------------------------------------------------------

export const INCIDENT_KINDS = ['medical', 'injury', 'fire', 'missing_child', 'other'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export const INCIDENT_OUTCOMES = [
  'resolved_on_site',
  'sent_home',
  'hospital',
  'false_alarm',
] as const;
export type IncidentOutcome = (typeof INCIDENT_OUTCOMES)[number];
export const PARTNER_KINDS = ['hospital', 'clinic', 'ambulance', 'pharmacy'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

/** The break-glass reason written for an SOS: who needs help, where (10+ characters always). */
export const sosReason = (kind: IncidentKind, location: string) =>
  `SOS (${kind.replace('_', ' ')}) at ${location.trim()}`.slice(0, 500);
