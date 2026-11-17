// Onboarding: an invited organisation admin creates their organisation, its campuses and their
// institutions (schools in this release; colleges and universities later), and their own
// profile. One transaction: the whole tree, the school roles, the admin as an organisation-wide
// school administrator linked to their login, and the customer record on the invite's plan.
import type { Db } from '@campusverse/db';
import { completeInvite, pendingInvite, registerCustomer } from '@campusverse/platform-control';
import { inviteAccount } from '@campusverse/platform-identity';
import { createOrganisationTree, type NewTree } from '@campusverse/platform-organisation';
import { addPhone, createPerson, ensureStaffProfile } from '@campusverse/people-records';
import { assignRole } from '@campusverse/platform-permissions';
import { sql } from 'drizzle-orm';
import { installExpenseCategories } from '@campusverse/shared-expenses';
import { installHelpdeskCategories } from '@campusverse/shared-helpdesk';
import { installAssetCategories } from '@campusverse/shared-assets';
import { installLeaveTypes } from '@campusverse/shared-staff-attendance';
import { installRoles } from './roles.js';
import { SetupError } from './common.js';

export type OnboardingInput = {
  admin: { name: string; designation: string; email?: string | null | undefined };
  organisation: Omit<NewTree, 'campuses'>;
  campuses: NewTree['campuses'];
};

export type Onboarded = {
  orgId: string;
  personId: string;
  institutions: { institutionId: string; name: string; campus: string }[];
};

export async function completeOnboarding(
  db: Db,
  accountId: string,
  input: OnboardingInput,
): Promise<Onboarded> {
  const invite = await pendingInvite(db, accountId);
  if (!invite) throw new SetupError('not_invited');
  if (input.campuses.length === 0 || input.campuses.some((c) => c.institutions.length === 0))
    throw new SetupError('empty_campus');

  const { tree, result } = await createOrganisationTree(
    db,
    { ...input.organisation, campuses: input.campuses },
    async (tx, t) => {
      await installRoles(tx);
      await installLeaveTypes(tx);
      await installExpenseCategories(tx);
      await installHelpdeskCategories(tx);
      await installAssetCategories(tx);
      const personId = await createPerson(tx, { legalName: input.admin.name, source: 'signup' });
      await addPhone(tx, personId, invite.phone);
      await ensureStaffProfile(tx, personId, {
        employeeCode: 'ADMIN-1',
        workEmail: input.admin.email?.toLowerCase() ?? invite.email,
      });
      await tx.execute(sql`
        update staff_profile set designation = ${input.admin.designation}
        where org_id = app_current_org() and person_id = ${personId}`);
      await assignRole(tx, {
        personId,
        roleKey: 'school_admin',
        scope: { type: 'organisation', id: t.orgId },
      });
      await assignRole(tx, {
        personId,
        roleKey: 'owner',
        scope: { type: 'organisation', id: t.orgId },
      });
      await inviteAccount(tx, {
        orgId: t.orgId,
        personId,
        phone: invite.phone,
        email: input.admin.email ?? invite.email,
      });
      await registerCustomer(tx, {
        orgId: t.orgId,
        name: input.organisation.name,
        planCode: invite.planCode,
      });
      await completeInvite(tx, invite.inviteId, t.orgId);
      return { personId };
    },
  );
  return {
    orgId: tree.orgId,
    personId: result.personId,
    institutions: tree.campuses.flatMap((c, ci) =>
      c.institutionIds.map((institutionId, ii) => ({
        institutionId,
        name: input.campuses[ci]?.institutions[ii]?.name ?? '',
        campus: c.name,
      })),
    ),
  };
}
