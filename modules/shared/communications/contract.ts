// Public API of communications: one delivery engine with per-channel status and fallback.
import { CONSENT_CHANGED } from '@campusverse/platform-consent';
import type { Consumer, Task } from '@campusverse/platform-events';
import {
  CHECK_DELIVERY,
  DISPATCH_LATER,
  dispatch,
  fallback,
  recordDeliveryStatus,
  type CommsDeps,
} from './application/delivery.js';
import { MESSAGE_QUEUED, requestMessage } from './application/messages.js';
import { COPY } from './copy.js';
import {
  NOTICE_DUE,
  NOTICE_SCHEDULED,
  releaseNotice,
  type AudiencePort,
} from './application/notices.js';

export {
  Unreachable,
  deliveryCounts,
  recordDeliveryStatus,
  type CommsDeps,
  type OutgoingMessage,
  type Provider,
} from './application/delivery.js';
export {
  MESSAGE_QUEUED,
  messageStates,
  notifyGuardians,
  requestMessage,
  type MessageInput,
  type MessageState,
} from './application/messages.js';
export { PLANS, type Channel, type Kind } from './domain/plan.js';
export {
  approveNotice,
  audienceGroups,
  cancelNotice,
  composeNotice,
  LANGUAGES,
  listNotices,
  NOTICE_DUE,
  NOTICE_SCHEDULED,
  NoticeError,
  combineAudiences,
  noticeDetail,
  previewNotice,
  releaseNotice,
  sendNotice,
  UNDO_WINDOW_MS,
  type Audience,
  type AudienceGroup,
  type AudiencePeriod,
  type AudiencePort,
  type Language,
  type NoticeDeps,
  type NoticeDetail,
  type NoticeInput,
  type NoticeKind,
  type NoticePreview,
  type NoticeSummary,
} from './application/notices.js';
export {
  acknowledge,
  markRead,
  myLanguage,
  myMessages,
  registerPushToken,
  setMyLanguage,
  type InboxItem,
} from './application/inbox.js';

/** Consumers and tasks for the worker. deps.schedule may be bound after the runtime is built. */
export function communicationsJobs(deps: CommsDeps & { audience: AudiencePort }): {
  consumers: Consumer[];
  tasks: Task[];
} {
  return {
    consumers: [
      {
        // Repeat-safe: the task releases only a scheduled notice that is due.
        name: 'communications.notice-schedule',
        queue: 'notifications',
        events: [NOTICE_SCHEDULED],
        afterCommit: async (_db, e) => {
          const p = e.payload as { noticeId: string; delayMs: number };
          await deps.schedule(NOTICE_DUE, { orgId: e.orgId, noticeId: p.noticeId }, p.delayMs);
        },
      },
      {
        name: 'communications.dispatch',
        queue: 'notifications',
        events: [MESSAGE_QUEUED],
        afterCommit: (db, e) => dispatch(db, deps, e.orgId, String(e.payload.messageId)),
      },
      {
        // Tells the guardian their consent decision was recorded.
        name: 'communications.consent-receipt',
        queue: 'notifications',
        events: [CONSENT_CHANGED],
        handle: async (tx, e) => {
          const p = e.payload as { guardianId: string; purpose: string; decision: string };
          await requestMessage(tx, {
            recipientPersonId: p.guardianId,
            kind: 'account',
            language: 'en',
            title: COPY.en.consentRecordedTitle,
            body: COPY.en.consentRecordedBody(p.purpose, p.decision),
            dedupeKey: `consent-receipt:${e.id}`,
          });
        },
      },
    ],
    tasks: [
      {
        name: NOTICE_DUE,
        queue: 'notifications',
        run: async (db, data) => {
          const { orgId, noticeId } = data as { orgId: string; noticeId: string };
          // A retry that comes early (clock skew) tries again shortly.
          if ((await releaseNotice(db, deps.audience, orgId, noticeId)) === 'not_due') {
            await deps.schedule(NOTICE_DUE, data, 5_000);
          }
        },
      },
      {
        // Messages held by the messaging_off switch: dispatch checks again and re-schedules.
        name: DISPATCH_LATER,
        queue: 'notifications',
        run: (db, data) => {
          const { orgId, messageId } = data as { orgId: string; messageId: string };
          return dispatch(db, deps, orgId, messageId);
        },
      },
      {
        name: CHECK_DELIVERY,
        queue: 'notifications',
        run: (db, data) => {
          const { orgId, messageId } = data as { orgId: string; messageId: string };
          return fallback(db, deps, orgId, messageId);
        },
      },
    ],
  };
}

/** For webhook controllers: apply a provider status update. */
export const deliveryWebhook = recordDeliveryStatus;
export { noticeTools } from './application/verse.js';
