// Public API of the helpdesk (docs/specs/HELPDESK.md): categories, requests from staff and
// parents, threads, assignment, states and figures; the worker's messages; Verse AI tools.
export {
  DEFAULT_CATEGORIES,
  HelpdeskError,
  TICKET_ASSIGNED,
  TICKET_RAISED,
  TICKET_REPLIED,
  TICKET_RESOLVED,
  assignTicket,
  helpdeskCategories,
  helpdeskFigures,
  installHelpdeskCategories,
  myRequests,
  raiseTicket,
  replyTicket,
  saveCategory,
  setTicketState,
  ticket,
  tickets,
  ticketsAbout,
  type Category,
  type HelpdeskDeps,
  type HelpdeskFigures,
  type QueueView,
  type RaiseInput,
  type TicketMessage,
  type TicketRow,
} from './application/helpdesk.js';
export { COPY as HELPDESK_COPY, helpdeskJobs } from './application/jobs.js';
export { helpdeskTools } from './application/verse.js';
export { afterReply, dueAt, isOverdue, type Priority, type State } from './domain/helpdesk.js';
