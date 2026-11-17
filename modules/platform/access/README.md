# platform/access

Roles and access on screen (docs/specs/INSTITUTION_DEPTH.md, decision 0020).

| Use case                                         | What                                                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessOverview`                                 | Every role with its permissions, holders, waiting grants; the grant requests; the owners (`platform.role.read`)                                                                                                                        |
| `createRole`, `renameRole`, `setRolePermissions` | Owners (`platform.role.manage`). Ordinary permissions apply now; sensitive ones (`domain/catalogue.ts`) wait in `role_grant_request`; removals are immediate. Nobody gives what they don't hold. The owner and parent roles are locked |
| `decideGrant`                                    | Another owner approves or rejects (`platform.role.approve`); the database refuses an approval by the requester. A sole owner may confirm alone, recorded as `confirmed_alone`                                                          |
| `accessOf`, `assignAccess`, `endAccess`          | Who holds what, where (organisation, campus or institution), from and until when (`platform.role.assign`). Nobody assigns a role holding permissions they lack. The last owner can't be removed                                        |

Role and grant rows are written through the permissions module's contract; its triggers make cached permission snapshots stale at once.

**The four-part check (rule book §10.3):** every catalogue permission has a data class (`dataClassOf`: public, internal, personal, financial or sensitive), shown on the Roles screen. Sensitive data is opt-in per role (a sensitive grant waits for a second owner). For one case, the Data Protection Officer (`platform.privacy.manage`) can let one person use one sensitive permission about one person for up to a week (`grantCase`, `endCase`, `caseGrants`; Privacy & Consent › Case access): never to themselves, with a reason, logged as sensitive. `explainAccess` (Settings › People and access › Check access, `platform.role.read`) shows why someone can or can't: the roles that carry the permission and whether they reach the place, whether it needs a relationship, its data class and any case grant. Verse AI calls the same check before every tool, so it inherits all of this.

**Owns:** `role_grant_request`. **Events:** `platform.role.changed.v1`, `platform.access.changed.v1`, `platform.access.case_granted.v1`, `platform.access.case_ended.v1`.

**Not yet:** scope nodes below the institution (institute or wing, department); telling the grantee when a case grant starts and ends; time-boxed duties on screen (they exist as `staff_duty`), approval for assigning the owner role, permission diffs in the approval notification.
