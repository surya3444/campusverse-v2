# school/returns — Quality & Compliance › Government Reports (schools)

Rule book §13.11 and §15 (UDISE+ and PEN).

- `udiseReadiness`: for one school, every current student with class, admission number, gender, date of birth, father's, mother's or guardian's name, PEN and APAAR status, and what is missing for UDISE+ (`missingForUdise`). PEN and APAAR never block anything; a refused APAAR is not "missing". It checks readiness only; it does not claim to be the UDISE+ upload format, which changes by year.
- Needs `school.returns.read` at the school. The web exports the list through the audited CSV export (`udise_students`).
- Facts come from people/records (`studentIdsAt`, `studentFactsFor`), class and admission number from the school's placement port.

- `reconcileApaar` (rule book §15: "APAAR capture with consent; … reconciliation"; P0 item 15): a CSV from the UDISE+ portal (PEN, APAAR ID and the student's name, columns in any order; `parseApaarCsv`) matched to the school's students by PEN, with the names agreeing word for word (`namesAgree`). A dry run shows each row's outcome; with `apply` (also `people.student.update`) only rows whose APAAR consent counts — granted by a guardian verified as an identifiable adult (platform/consent `consentCounts`) — are stored, sealed through people/records `setApaarIdsIn`, and audited as restricted.

**Owned tables:** none. **Events:** none.
