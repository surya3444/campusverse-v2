# platform/organisation

The organisation, its legal entity, campuses and institutions: created at onboarding, edited afterwards (docs/specs/INSTITUTION_DEPTH.md, Milestone 19).

| Use case                                                                   | What                                                                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `createOrganisationTree`, `organisationTree`, `placeOf`, `institutionInfo` | Onboarding in one transaction; the scope switcher; where an institution sits                                                                |
| `organisationProfile`, `updateOrganisation`, `setOrganisationLogo`         | Owners (`platform.organisation.manage`): name, legal name, GSTIN, registered address, contacts, document colour, logo, owner-defined fields |
| `addCampus`, `updateCampus`, `setCampusPhoto`                              | Campuses with address, contacts, photo, and the gate location with a radius for staff check-in (Milestone 20)                               |
| `addInstitution`                                                           | A school added to a campus after onboarding; colleges and universities stay "coming soon"                                                   |
| `brandFiles`                                                               | Which logo and photo files are current, for everyone in the organisation                                                                    |

Changes are audited with the names of the fields changed, never their values. Images are stored by platform/documents and served only once scanned clean.

**Owns:** `organisation`, `legal_entity` (with its TAN for TDS, migration 0071), `campus`, `institution` (the school module still writes institution profile columns in setup; to move behind this contract). **Events:** `platform.organisation.changed.v1`.

**Not yet:** closing a campus, moving a school between campuses, a wide logo for letterheads, PAN for the legal entity (sealed).
