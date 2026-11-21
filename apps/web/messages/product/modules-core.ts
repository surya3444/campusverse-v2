// Live modules of Campus Core and Verse AI, for the public product pages.
import type { ModuleContent } from './types';

export const CORE_MODULES: Record<string, ModuleContent> = {
  organisation: {
    tagline: 'Your group, campuses, institutions and departments, as they really are.',
    overview:
      'The organisation is a tree of any depth: a group or trust, campuses, institutions on them, and departments within. Each institution has a profile (school, affiliated or autonomous college, university) that switches modules, words and rules. Legal entities own receipts and ledgers. Affiliation to a university is a link, never a parent.',
    capabilities: [
      ['A tree of any depth', 'Group, campus, institution, wing and department.'],
      ['Institution profiles', 'Words, modules and rule packs switch with the profile.'],
      ['Legal entities', 'Receipts and ledgers per entity, with its TAN.'],
      ['Self-serve setup', 'Sign up and build the tree in a guided onboarding.'],
      ['All institutions view', 'Every campus of a group at a glance.'],
      ['Affiliation as a link', 'A college links to its university without being part of it.'],
    ],
    steps: [
      ['Sign up', 'Tell us what you run.'],
      ['Build', 'Campuses and institutions in onboarding.'],
      ['Profile', 'Each institution gets its profile and authority.'],
      ['Grow', 'Add campuses and institutions as you expand.'],
    ],
    roles: [
      ['Owner', 'Builds and changes the tree.'],
      ['Administrator', 'Maintains institutions.'],
    ],
    guardrails: ['Each organisation’s data is isolated in the database itself'],
    related: ['access', 'rulePacks', 'dataImport'],
  },
  access: {
    tagline: 'Roles, scopes and data classes, with an explanation for every answer.',
    overview:
      'Access is role × scope × relationship × data class. A teacher’s role at their school, a parent’s relationship to their own child, and data classes on every permission decide what each person sees. Sensitive data such as health or category certificates is opt-in per role, case grants open one record for one purpose, and Check access explains any yes or no.',
    capabilities: [
      ['Roles from templates', 'Ready-made roles per profile, customised per organisation.'],
      ['Scopes', 'Organisation, campus or institution.'],
      ['Relationships', 'A parent sees their own child; a teacher their own sections.'],
      ['Data classes', 'Operational, personal, sensitive and restricted on every permission.'],
      ['Case grants', 'Time-limited access to one record for one reason.'],
      ['Check access', 'Explains why someone can or can’t do something.'],
    ],
    steps: [
      ['Design', 'Roles and their permissions.'],
      ['Assign', 'Roles to people at a scope.'],
      ['Grant', 'Case grants when needed.'],
      ['Explain', 'Check access when someone asks why.'],
    ],
    roles: [
      ['Owner', 'Designs roles and assigns them.'],
      ['Data protection officer', 'Watches sensitive access.'],
    ],
    guardrails: [
      'Every request is checked on the server, whatever the screen shows',
      'MFA for staff, OTP for parents',
    ],
    related: ['privacy', 'activityLog', 'organisation'],
  },
  rulePacks: {
    tagline: 'Regulation as data: versioned, tested and released on a date.',
    overview:
      'Board rules, grading, credits, payroll and state rules live in rule packs, not in code. Each pack version carries its source, its effective dates and test cases; a second owner releases it, and each institution switches it on from a date. A new circular becomes a pack version, not a software release.',
    capabilities: [
      ['Versions with sources', 'Every value traced to its circular or act.'],
      ['Test cases', 'A version must pass its tests to be released.'],
      ['Released by a second owner', 'Never by the person who drafted it.'],
      ['Effective dates', 'Switched on per institution from a date.'],
      ['Frozen results', 'A result keeps the version it was graded under.'],
      ['Many domains', 'Grading, credits, attendance, payroll, gratuity, LWF and TC deadlines.'],
    ],
    steps: [
      ['Draft', 'A new version from a circular.'],
      ['Test', 'Run its test cases.'],
      ['Release', 'A second owner releases it.'],
      ['Adopt', 'Institutions switch it on from a date.'],
    ],
    roles: [
      ['Compliance owner', 'Drafts and releases versions.'],
      ['Administrator', 'Adopts them per institution.'],
    ],
    guardrails: ['Values are starting points for counsel to confirm, not legal advice'],
    related: ['exams', 'payroll', 'attendance'],
  },
  workflow: {
    tagline: 'One approval engine for everything that needs a second person.',
    overview:
      'Bills, refunds, results, registrations, re-exams, condonation, leave, settlements and notices all go through one approval engine. The designer sets the steps, the roles and scopes that decide, amount limits that add steps, and timers that escalate. Everything waiting for you is in My Work, oldest first.',
    capabilities: [
      ['The approval designer', 'Steps, deciders and amount limits per process.'],
      ['Escalation', 'Timers that move a waiting step up.'],
      ['My Work', 'Everything waiting for you across institutions.'],
      ['Never your own', 'Nobody approves a request they made.'],
      ['Withdraw', 'The requester can withdraw before a decision.'],
      ['A full trail', 'Every step and decision recorded.'],
    ],
    steps: [
      ['Design', 'The steps for each process.'],
      ['Request', 'A module starts an approval.'],
      ['Decide', 'Each step decides in My Work.'],
      ['Finish', 'The module acts on the outcome.'],
    ],
    roles: [
      ['Administrator', 'Designs the processes.'],
      ['Approvers', 'Decide in My Work.'],
    ],
    guardrails: ['Amount limits add steps; they never skip them'],
    related: ['accounts', 'payroll', 'exams'],
  },
  communications: {
    tagline: 'Notices and messages on every channel, tracked to delivery.',
    overview:
      'One communications service sends SMS, WhatsApp, push and in-app messages with templates per language. Notices to classes, sections, bus routes or fare zones are previewed, approved where needed and scheduled, with an undo window. Each recipient has their own delivery status, fallbacks between channels, and acknowledgements when the school asks for them.',
    capabilities: [
      ['Every channel', 'SMS with DLT templates, WhatsApp, push and in-app.'],
      ['Audiences', 'Whole school, classes, sections, routes and fare zones.'],
      ['Preview and approval', 'Notices approved before they go, with an undo window.'],
      ['Languages', 'Templates in English and Indian languages.'],
      ['Delivery per person', 'Sent, delivered and read, with fallback.'],
      ['Acknowledgements', 'Parents acknowledge important notices.'],
    ],
    steps: [
      ['Compose', 'Write the notice and pick the audience.'],
      ['Preview', 'See who receives it.'],
      ['Approve', 'Where the process needs it.'],
      ['Track', 'Delivery and acknowledgements.'],
    ],
    roles: [
      ['Office', 'Composes notices.'],
      ['Principal', 'Approves them.'],
      ['Parent', 'Receives and acknowledges.'],
    ],
    guardrails: [
      'Restricted guardians receive nothing on any channel',
      'Outside the live environment, messages go only to allowed numbers',
    ],
    related: ['workflow', 'privacy', 'helpdesk'],
  },
  privacy: {
    tagline: 'DPDP consent, guardian verification and data rights.',
    overview:
      'Privacy & Consent holds purpose-wise consent for every person, decided by guardians in the parent app for children. Guardian verification follows DPDP Rule 10. Data-rights requests (access, correction, erasure) are tracked to their deadlines, and the breach register records incidents for reporting.',
    capabilities: [
      ['Consent by purpose', 'Each purpose agreed or declined separately.'],
      ['Guardians decide', 'In the parent app, for their children.'],
      ['Guardian verification', 'Under DPDP Rule 10 before children’s data is processed.'],
      ['Data-rights requests', 'Access, correction and erasure tracked to deadlines.'],
      ['Breach register', 'Incidents recorded for reporting.'],
      ['The console', 'Consent coverage and requests at a glance.'],
    ],
    steps: [
      ['Notice', 'Families see the privacy notice.'],
      ['Verify', 'Guardians are verified.'],
      ['Consent', 'Purposes agreed or declined.'],
      ['Respect', 'Requests answered on time.'],
    ],
    roles: [
      ['Data protection officer', 'Runs the console and requests.'],
      ['Parent', 'Decides consent for their child.'],
    ],
    guardrails: ['§15 is a summary of public sources; counsel confirms privacy items'],
    related: ['access', 'activityLog', 'healthRecords'],
  },
  activityLog: {
    tagline: 'A tamper-evident record of every change.',
    overview:
      'Every change, export, reveal of a sealed identifier and Verse AI step is written to the activity log with who, what, when and why. Entries are sealed in a hash chain so tampering shows, kept in India for 180 days or more as CERT-In requires.',
    capabilities: [
      ['Everything recorded', 'Changes, exports, reveals and Verse AI steps.'],
      ['Who, what, when, why', 'With reasons where the action needed one.'],
      ['Hash-chain seals', 'Tampering with any entry breaks the chain.'],
      ['Kept in India', '180 days or more.'],
      ['Record stamps', 'Who created and last changed each record.'],
      ['Searchable', 'By person, record or action.'],
    ],
    steps: [
      ['Act', 'Any change in any module.'],
      ['Record', 'Written with its actor and reason.'],
      ['Seal', 'Added to the hash chain.'],
      ['Review', 'Searched when questions arise.'],
    ],
    roles: [
      ['Owner', 'Reviews activity.'],
      ['Data protection officer', 'Investigates access.'],
    ],
    guardrails: ['Audit rows are append-only'],
    related: ['access', 'privacy'],
  },
  dataImport: {
    tagline: 'Bring your data in, checked row by row, with undo.',
    overview:
      'Download a template or export from Campusverse V1, upload it, and every row is checked and shown as ready, with errors or as a possible duplicate before anything is created. Import the ready rows; undo removes exactly what the batch created until its records are in use.',
    capabilities: [
      ['Templates', 'For students and guardians, and for staff.'],
      ['V1 importers', 'Students and staff straight from Campusverse V1 exports.'],
      ['A dry run', 'Every row checked before anything is created.'],
      ['Duplicates flagged', 'The same child or staff member caught.'],
      ['Undo', 'Removes exactly what the batch created.'],
      ['Colleges too', 'Staff here; students straight into a batch.'],
    ],
    steps: [
      ['Download', 'The template, or export from V1.'],
      ['Upload', 'See every row checked.'],
      ['Import', 'The ready rows only.'],
      ['Undo if needed', 'Before the records are in use.'],
    ],
    roles: [
      ['Administrator', 'Imports and undoes batches.'],
      ['Implementation team', 'Moves your data during onboarding.'],
    ],
    guardrails: ['Nothing is created before you confirm'],
    related: ['studentRecords', 'hr', 'organisation'],
  },
  verse: {
    tagline: 'Ask Verse AI anything about your campus, within your permissions.',
    overview:
      'Verse AI answers questions in plain words using the same permissioned tools as the screens. It shows its sources, drafts messages and reminders for a person to send, takes reversible actions only after one confirm, and needs a second approver for sensitive ones. Every step is in the activity log.',
    capabilities: [
      ['Plain-language questions', 'About attendance, fees, staff, buses and more.'],
      ['Sources shown', 'Each answer points to its records.'],
      ['Drafts', 'Notices, reminders and replies left for you to send.'],
      ['Action classes', 'Read, draft, reversible and sensitive, each with its rule.'],
      ['Policy guard', 'Every request checked against your permissions first.'],
      ['Model-neutral', 'Runs on the model your institution chooses.'],
    ],
    steps: [
      ['Ask', 'In the command bar or the Verse AI page.'],
      ['Check', 'Your permissions are checked.'],
      ['Answer', 'With sources, or a draft.'],
      ['Confirm', 'Actions only with your confirmation.'],
    ],
    roles: [
      ['Principal', 'Asks about the day and the term.'],
      ['Office', 'Drafts reminders and replies.'],
      ['Teacher', 'Asks about their sections.'],
    ],
    guardrails: [
      'Never trains on institution data',
      'Never profiles or advertises to children',
      'Students under 18 get study help only',
    ],
    related: ['activityLog', 'communications', 'access'],
  },
};
