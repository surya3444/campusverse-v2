import { registerCustomer } from '@campusverse/platform-control';
import type { Db } from '@campusverse/db';
import { inviteAccount, normaliseIndianMobile } from '@campusverse/platform-identity';
import { createOrganisation, type CampusTree } from '@campusverse/platform-organisation';
import type { BoardCode, StateCode } from '@campusverse/rules';
import { addPhone, createPerson } from '@campusverse/people-records';
import { assignRole } from '@campusverse/platform-permissions';
import { installExpenseCategories } from '@campusverse/shared-expenses';
import { installHelpdeskCategories } from '@campusverse/shared-helpdesk';
import { installAssetCategories } from '@campusverse/shared-assets';
import { installLeaveTypes } from '@campusverse/shared-staff-attendance';
import { installRoles } from './roles.js';

export type NewSchool = {
  schoolName: string;
  /** One school, or a group with several. The wizard hides legal entity and campus for one school. */
  group: { name: string; legalEntityName: string; campusName: string } | null;
  board: BoardCode;
  state: StateCode;
  owner: { name: string; phone: string; email?: string | null };
};

/**
 * Wizard step 1: a school signs up. Creates the campus tree, the school's copy of the role
 * templates, and the owner as an organisation-wide school administrator with a login.
 */
export async function provisionSchool(
  db: Db,
  input: NewSchool,
): Promise<CampusTree & { ownerPersonId: string; ownerAccountId: string }> {
  const phone = normaliseIndianMobile(input.owner.phone);
  if (!phone) throw new Error('provisionSchool: owner phone is not a valid Indian mobile');
  const { tree, result } = await createOrganisation(
    db,
    {
      name: input.group?.name ?? input.schoolName,
      legalEntityName: input.group?.legalEntityName ?? input.schoolName,
      campusName: input.group?.campusName ?? 'Main campus',
      institution: {
        name: input.schoolName,
        type: 'school',
        authorityCode: input.board,
        stateCode: input.state,
      },
    },
    async (tx, tree) => {
      await installRoles(tx);
      await installLeaveTypes(tx);
      await installExpenseCategories(tx);
      await installHelpdeskCategories(tx);
      await installAssetCategories(tx);
      const ownerId = await createPerson(tx, { legalName: input.owner.name, source: 'signup' });
      await addPhone(tx, ownerId, phone);
      await assignRole(tx, {
        personId: ownerId,
        roleKey: 'school_admin',
        scope: { type: 'organisation', id: tree.orgId },
      });
      await assignRole(tx, {
        personId: ownerId,
        roleKey: 'owner',
        scope: { type: 'organisation', id: tree.orgId },
      });
      const login = await inviteAccount(tx, {
        orgId: tree.orgId,
        personId: ownerId,
        phone,
        email: input.owner.email ?? null,
      });
      await registerCustomer(tx, {
        orgId: tree.orgId,
        name: input.group?.name ?? input.schoolName,
      });
      return { ownerPersonId: ownerId, ownerAccountId: login.accountId };
    },
  );
  return { ...tree, ...result };
}
