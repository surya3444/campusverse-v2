// Student ID cards (rule book §13.3 "Enrol … ID card", §13.5 Certificates & ID Cards): one
// student's card, or a whole section's on A4 sheets, with photo, class, roll and admission
// numbers, date of birth and the year the card is valid for. Health details (blood group) stay
// off the card: Health Connect data is never printed outside the vault.
import { withTenant, type Tx } from '@campusverse/db';
import { displayNames, photoFilesOf, studentFactsFor } from '@campusverse/people-records';
import { institutionInfo } from '@campusverse/platform-organisation';
import { cleanFileBytes, renderIdCards, type IdCard } from '@campusverse/platform-documents';
import { command } from '@campusverse/platform-events';
import type { Actor } from '@campusverse/platform-permissions';
import { enrolmentFacts, sectionOf, sectionRoster } from '@campusverse/school-enrolment';
import { sectionInfo } from '@campusverse/school-setup';
import { sql } from 'drizzle-orm';
import { dateFigures } from '../domain/certificate.js';
import { CertificateError, type CertificateDeps } from './certificates.js';

const today = async (tx: Tx) =>
  (await tx.execute<{ d: string }>(sql`select app_today()::text as d`))[0]?.d ?? '';

/** Last day of a year whose end is exclusive. */
const dayBefore = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

/** A PDF of ID cards for a section (or one student in it). Office staff who issue certificates. */
export async function idCards(
  deps: CertificateDeps,
  actor: Actor,
  input: { sectionId?: string | null; studentId?: string | null },
): Promise<{ pdf: Uint8Array; fileName: string; count: number }> {
  const { place, sectionId } = await withTenant(deps.db, actor.orgId, async (tx) => {
    const on = await today(tx);
    // One student's card: their section today.
    const id =
      input.sectionId ?? (input.studentId ? await sectionOf(tx, input.studentId, on) : null);
    const s = id ? await sectionInfo(tx, id, on) : null;
    if (!s || !id) throw new CertificateError('section_not_found');
    return {
      sectionId: id,
      place: { campusId: s.campusId, institutionId: s.institutionId },
    };
  });
  // A command for its Activity Log row: printing cards is an export of students' details.
  const data = await command(
    deps.db,
    deps.permissions,
    actor,
    { permission: 'school.certificate.request', resource: { orgId: actor.orgId, place } },
    async (tx) => {
      const on = await today(tx);
      const section = await sectionInfo(tx, sectionId, on);
      if (!section) throw new CertificateError('section_not_found');
      const roster = (await sectionRoster(tx, sectionId, on)).filter(
        (r) => !input.studentId || r.personId === input.studentId,
      );
      if (roster.length === 0) throw new CertificateError('no_students');
      const ids = roster.map((r) => r.personId);
      const facts = new Map((await studentFactsFor(tx, ids)).map((f) => [f.personId, f]));
      const photos = await photoFilesOf(tx, ids);
      const names = await displayNames(tx, ids);
      const school = await institutionInfo(tx, section.institutionId);
      const rows = [];
      for (const r of roster) {
        const e = await enrolmentFacts(tx, r.personId, on);
        rows.push({ ...r, admissionNumber: e?.admissionNumber ?? null });
      }
      return {
        result: {
          section,
          rows,
          facts,
          photos,
          names,
          school,
          validTill: dayBefore(section.yearEnds),
        },
        audit: {
          action: 'school.certificate.id_cards',
          entityType: 'school_section',
          entityId: sectionId,
          dataClass: 'personal',
          detail: { students: rows.length, studentId: input.studentId ?? null },
        },
      };
    },
  );

  const cards: IdCard[] = [];
  for (const r of data.rows) {
    const fileId = data.photos.get(r.personId);
    let photo: IdCard['photo'] = null;
    if (fileId) {
      try {
        const f = await cleanFileBytes(deps.db, deps.store, actor.orgId, fileId);
        photo = { bytes: f.bytes, contentType: f.contentType };
      } catch {
        photo = null; // A photo still being scanned prints as an empty box.
      }
    }
    const dob = data.facts.get(r.personId)?.dateOfBirth;
    cards.push({
      name: data.names[r.personId] ?? r.name,
      photo,
      lines: [
        ['Class', data.section.label],
        ['Roll no.', r.rollNumber ? String(r.rollNumber) : '-'],
        ['Admission no.', r.admissionNumber ?? '-'],
        ['Date of birth', dob ? dateFigures(dob) : '-'],
        ['Valid till', dateFigures(data.validTill)],
      ],
    });
  }
  // ponytail: Latin-script names only until the PDF fonts carry Indian scripts (as certificates).
  let pdf: Uint8Array;
  try {
    pdf = await renderIdCards({
      schoolName: data.school?.name ?? 'School',
      footer: `If found, please return to ${data.school?.name ?? 'the school'}.`,
      cards,
    });
  } catch {
    throw new CertificateError('not_printable');
  }
  const who = input.studentId ? (data.rows[0]?.admissionNumber ?? 'student') : data.section.label;
  return {
    pdf,
    fileName: `id-cards-${who.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`,
    count: cards.length,
  };
}
