// Worker entry point: relays the outbox to BullMQ and runs every consumer and task.
import { loadEnv, simulating } from '@campusverse/config';
import { createDb } from '@campusverse/db';
import {
  createS3Store,
  devScanner,
  guardDutyScanner,
  s3ScanTag,
  scanConsumer,
} from '@campusverse/platform-documents';
import { createRuntime, redisConnection, type Runtime } from '@campusverse/platform-events';
import { attendanceJobs } from '@campusverse/school-attendance';
import { chooseGateway, financeJobs } from '@campusverse/shared-finance';
import {
  importCommitConsumer,
  invitesConsumer,
  schoolAudience,
  staffExitConsumer,
} from '@campusverse/school-setup';
import {
  combineAudiences,
  communicationsJobs,
  type Provider,
} from '@campusverse/shared-communications';
import { transportAudience, transportJobs } from '@campusverse/shared-transport';
import { homeworkJobs } from '@campusverse/school-homework';
import { admissionsJobs } from '@campusverse/school-admissions';
import { gateJobs } from '@campusverse/shared-gate';
import { hostelAudience, hostelJobs } from '@campusverse/shared-hostel';
import { helpdeskJobs } from '@campusverse/shared-helpdesk';
import { mentoringJobs } from '@campusverse/shared-mentoring';
import { grievanceJobs } from '@campusverse/shared-grievances';
import { healthJobs } from '@campusverse/shared-health';
import { coverJobs, generationJobs } from '@campusverse/school-timetable';
import { schoolPlacement } from '@campusverse/school-enrolment';
import { switchOn } from '@campusverse/platform-control';
import { randomUUID } from 'node:crypto';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);
const store = createS3Store({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
});
// Uploaded files: GuardDuty's malware scan in AWS (test and live), the EICAR check locally.
const scanner = env.S3_ENDPOINT
  ? devScanner(env.APP_ENV)
  : guardDutyScanner(s3ScanTag({ bucket: env.S3_BUCKET, region: env.S3_REGION }));

/**
 * Simulated push, WhatsApp and SMS: nothing leaves the system; the delivery is recorded as sent
 * by "simulated-<channel>", so schools see it in each notice's delivery status, and the worker
 * log shows a masked line.
 */
const simulatedProvider = (channel: string): Provider => ({
  name: `simulated-${channel}`,
  send: async (m) => {
    console.log(`[simulated ${channel}] to …${m.to.slice(-4)}: ${m.title}`);
    return { providerRef: randomUUID() };
  },
});

// Real providers arrive with their accounts. Until then, with simulation on (SIMULATE_PROVIDERS),
// messages are simulated; with it off, deliveries fail visibly as no_provider.
const simulate = simulating(env);
const providers = simulate
  ? {
      push: simulatedProvider('push'),
      whatsapp: simulatedProvider('whatsapp'),
      sms: simulatedProvider('sms'),
    }
  : {};

const comms = communicationsJobs({
  // Classes and sections, plus transport routes and fare zones (as the API's campusAudience).
  audience: combineAudiences(schoolAudience, transportAudience, hostelAudience),
  providers,
  // The allowlist protects real phones outside production; simulated messages reach no phone.
  allowlist: env.APP_ENV === 'production' || simulate ? null : new Set(env.MESSAGE_ALLOWLIST),
  // Bound late: only called once the runtime below exists.
  schedule: (task, data, delayMs) => runtime.schedule(task, data, delayMs),
  // Super admin's messaging_off switch: messages wait and go once it is turned off.
  paused: (orgId) => switchOn(db, 'messaging_off', orgId),
});

const attendance = attendanceJobs({
  schedule: (task, data, delayMs) => runtime.schedule(task, data, delayMs),
});

const finance = financeJobs({
  placements: [schoolPlacement],
  gateway: chooseGateway({
    appEnv: env.APP_ENV,
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  }),
  schedule: (task, data, delayMs) => runtime.schedule(task, data, delayMs),
});

const transport = transportJobs({
  schedule: (task, data, delayMs) => runtime.schedule(task, data, delayMs),
});

const runtime: Runtime = createRuntime({
  db,
  connection: redisConnection(env.REDIS_URL),
  consumers: [
    ...comms.consumers,
    scanConsumer(store, scanner),
    importCommitConsumer,
    invitesConsumer,
    staffExitConsumer,
    ...attendance.consumers,
    ...finance.consumers,
    ...transport.consumers,
    ...coverJobs(),
    ...generationJobs(),
    ...homeworkJobs(),
    ...admissionsJobs(),
    ...gateJobs(),
    ...hostelJobs(),
    ...helpdeskJobs(),
    ...mentoringJobs(),
    ...grievanceJobs(),
    ...healthJobs(),
  ],
  tasks: [...comms.tasks, ...attendance.tasks, ...finance.tasks, ...transport.tasks],
});
const workers = runtime.startWorkers();

// ponytail: polls every 250 ms; switch to LISTEN/NOTIFY if relay latency or load matters.
let relaying = false;
const relayTimer = setInterval(async () => {
  if (relaying) return;
  relaying = true;
  try {
    while ((await runtime.relay()) > 0);
  } catch (e) {
    console.error('relay failed', (e as Error).message);
  } finally {
    relaying = false;
  }
}, 250);

console.log(`worker started (${env.APP_ENV}): ${workers.length} queues`);

async function shutdown() {
  clearInterval(relayTimer);
  await Promise.all(workers.map((w) => w.close()));
  await runtime.close();
  await close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
