# shared/helpdesk

Help requests from staff and from parents about their child (docs/specs/HELPDESK.md). Names from people/records, a child's school and class through `AcademicPlacementPort`, messages through communications.

| Use case                                                          | What                                                                                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helpdeskCategories`, `saveCategory`, `installHelpdeskCategories` | Organisation-wide categories with hours to answer, a default assignee and who may use them (`helpdesk.setup.manage`)                                            |
| `raiseTicket`                                                     | Staff for themselves (`helpdesk.ticket.raise`, self), parents about their own child (guardian); numbered per school; due by the category's hours (urgent: half) |
| `tickets`, `ticket`                                               | Queues (open, overdue, waiting, resolved) for handlers; "mine" and "raised" for anyone; the thread, internal notes only for people working it                   |
| `replyTicket`, `setTicketState`, `assignTicket`                   | Replies move the state (`afterReply`); a requester reopens within 7 days; assignees must be staff of the school                                                 |
| `helpdeskFigures`, `helpdeskJobs`, `helpdeskTools`                | Figures by category; messages to requester and assignee (kind `helpdesk`); Verse AI `helpdesk.summary` and `helpdesk.ticket.reply` (act)                        |

**Owns:** `helpdesk_category`, `helpdesk_counter`, `helpdesk_ticket`, `helpdesk_message`. **Events:** `helpdesk.ticket.raised.v1`, `.replied.v1`, `.resolved.v1`, `.assigned.v1`.

**Not yet:** per-school assignees, closing after 7 days, satisfaction, attachments, escalation, canned replies, reports.
