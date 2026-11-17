# platform/workflow

Campus Core › Workflow & Approvals (rule book §12.4 decision 6, §13 Campus Core, P0 item 11): one engine for every module's approvals.

- **Designer** (`approvalDesign`, `saveApprovalSteps`, `platform.workflow.manage`, owners): up to six steps per process, each an approver role, an optional "from amount" (amount limits add steps for larger sums), and an optional timer with an escalation role. Steps are set for the whole organisation or for one institution, whose own steps then replace the organisation's there (a recorded branch override). With no steps, anyone holding the process's approval permission decides in one step: the behaviour before the engine.
- **Requests** (`startApproval`, `withdrawApproval`): started by the owning module inside its own transaction. The steps that apply at that moment are copied onto the request, so changing the design never moves a request already waiting.
- **Deciding** (`decideApproval`): the owning module calls it inside its command and applies the outcome (approved after the last step, rejected at once, else pending at the next step). Nobody decides their own request or two steps of one request; a rejection needs a reason. Who holds a role comes from platform/permissions (`rolesOf`, by scope: organisation, campus or institution).
- **Escalation** is worked out when someone looks: once a step's timer has run out, the escalation role may decide too, and the decision is marked escalated. No background job.
- **State and My Work** (`approvalStates`, `myWork`): each subject's latest request with its step, role name, due time and whether the viewer may decide; and everything waiting for the viewer across processes and institutions.

Processes on the engine (`PROCESSES` in `domain/workflow.ts`): `expenses.bill` (with amounts), `academics.registration`, `payroll.settlement` (with amounts), `academics.results`, `academics.reexam`, `academics.condonation`, `staff.leave`, `finance.refund` (with amounts; the payout reference at the last step), `communications.notice` (no requester recorded, so a principal may approve their own; urgent messages skip it).

**Owns:** `approval_step`, `approval_request`, `approval_decision` (append-only) (migrations 0058; backfills 0059, 0068 leave, 0069 refunds, 0070 notices).

**Not yet:** payroll runs, fee concessions and reversals, student leave, certificates and role grants on the engine (each keeps its own maker-checker until moved); messages to approvers when a step reaches them or escalates; delegation while someone is away; parallel steps.
