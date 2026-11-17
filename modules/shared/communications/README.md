# shared/communications

One delivery engine. Every message tracks its own state, and every guardian has their own delivery status per channel.

**Plans** (`domain/plan.ts`, from the spec's message-type table):

| Kind         | Channels            | Mode          | Counts as reached | Fallback timer |
| ------------ | ------------------- | ------------- | ----------------- | -------------- |
| urgent       | push, WhatsApp, SMS | together      | delivered         | none           |
| absence      | push → WhatsApp     | one at a time | delivered         | 15 min         |
| fee_receipt  | push, WhatsApp      | together      | delivered         | none           |
| fee_reminder | push → WhatsApp     | one at a time | delivered         | 6 h            |
| circular     | push → WhatsApp     | one at a time | **read**          | 24 h           |
| homework     | push only           | —             | delivered         | no fallback    |
| notice       | push, WhatsApp      | together      | delivered         | none           |
| account      | push → SMS          | one at a time | delivered         | 10 min         |

SMS is the last resort for every kind but homework, so a parent with no smartphone still gets the message.

**Rules:**

- `requestMessage` is idempotent by `dedupeKey`. `notifyGuardians` skips restricted guardians and respects their message flags.
- Each delivery is claimed atomically before sending, so it is sent once.
- A provider error, or an `Unreachable` error, moves on to the next channel. `Unreachable` also disables that contact.
- Webhook statuses only move forward; repeats and late updates are harmless.
- Outside production, WhatsApp and SMS go only to `MESSAGE_ALLOWLIST`.
- Message states: queued, sent, fallback_sent, delivered, read, acknowledged, failed. Opening a message in the app is a read on the push channel (`markRead`); `acknowledge` records acknowledged once, for notices that ask for it.

**Notices** (`application/notices.ts`, spec `docs/specs/PARENT_APP.md`): `composeNotice` (English required, plus kn, te, ta, hi, ur) → `approveNotice` (through the approval engine, `communications.notice`) → `previewNotice` (recipients by language, first channel, unreachable) → `sendNotice` (2-minute undo window; urgent from named roles goes at once, without approval) → `releaseNotice` in the worker → `noticeDetail` per guardian and channel. `cancelNotice` works until release. Each guardian gets one message (siblings share it), in their language if written, else English; restricted guardians and those with academic messages off get nothing.

**Audience:** communications knows nothing about classes. `AudiencePort` answers who is in an audience; school/setup implements it as `schoolAudience` (classes and sections).

**Inbox** (`application/inbox.ts`): `myMessages`, `markRead`, `acknowledge`, `myLanguage`, `setMyLanguage`, `registerPushToken`, all on the self relation (`communications.message.read_own`).

**Owned tables:** `person_contact`, `notification_message`, `notification_delivery`, `ops.delivery_ref` (migration 0003); `notice`, `notice_version`, `communication_preference`, and the notice, child, read and acknowledgement columns on messages (migration 0008).

**Events:** consumes `communications.message.queued.v1` and `platform.consent.changed.v1`; emits `communications.message.queued.v1`.

**Events:** `communications.message.queued.v1`, `communications.notice.scheduled.v1`; task `communications.notice-due`.

**Not yet:** real FCM, WhatsApp and SMS adapters (provider accounts), recall of a sent notice, per-school budget, digests, delivery error reasons on the tracking screen, and a sweeper for deliveries stuck in `sending`.
