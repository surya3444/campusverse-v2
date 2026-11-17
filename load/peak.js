// Load test (k6): the morning attendance rush and a parent-app peak at the same time.
//   docker run --rm --network <net> -v "$PWD/load:/load" -v <fixture>:/load/fixture.json \
//     -e API=http://api:4000 grafana/k6 run /load/peak.js
// The fixture comes from `pnpm --filter @campusverse/api load-school` (synthetic data only).
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const fx = JSON.parse(open('/load/fixture.json'));
const teachers = new SharedArray('teachers', () => fx.teachers);
const parents = new SharedArray('parents', () => fx.parents);
const API = `${__ENV.API}/api/v1`;
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date

export const options = {
  scenarios: {
    // Every class teacher opens the register and submits within the same few seconds.
    attendance: {
      executor: 'per-vu-iterations',
      vus: teachers.length,
      iterations: 1,
      exec: 'attendance',
      maxDuration: '2m',
    },
    // Parents open the app (results day, fee due date): 20 openings a second for two minutes,
    // 2,400 in all, each reading home and messages. Arrivals, not a closed loop.
    parents: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 100,
      maxVUs: 300,
      exec: 'parent',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:write}': ['p(95)<1500'],
    'http_req_duration{kind:read}': ['p(95)<500'],
  },
};

const as = (who) => ({
  headers: {
    authorization: `Bearer ${who.token}`,
    'x-org-id': fx.orgId,
    'x-person-id': who.personId,
    'content-type': 'application/json',
  },
});

// UUIDv7-shaped ids, as a device makes them.
function eventId() {
  const hex = Date.now().toString(16).padStart(12, '0');
  const r = () => Math.floor(Math.random() * 16).toString(16);
  const rand = (n) => Array.from({ length: n }, r).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand(3)}-8${rand(3)}-${rand(12)}`;
}

export function attendance() {
  // One iteration per teacher: the scenario's iteration number is unique across its VUs.
  const t = teachers[exec.scenario.iterationInTest];
  const p = as(t);
  const sheet = http.get(`${API}/school/attendance/sections/${t.sectionId}?date=${today}`, {
    ...p,
    tags: { kind: 'read', name: 'attendance sheet' },
  });
  check(sheet, { 'sheet 200': (r) => r.status === 200 });
  const marks = t.students.map((id, i) => ({
    personId: id,
    status: i % 12 === 0 ? 'absent' : 'present',
  }));
  const res = http.post(
    `${API}/sync/events`,
    JSON.stringify({
      events: [
        {
          eventId: eventId(),
          deviceId: `load-${t.personId}`,
          actorId: t.personId,
          occurredAt: new Date().toISOString(),
          type: 'attendance.mark',
          payload: { sectionId: t.sectionId, onDate: today, marks },
        },
      ],
    }),
    { ...p, tags: { kind: 'write', name: 'attendance submit' } },
  );
  check(res, {
    'submit 200': (r) => r.status === 200,
    'submit accepted': (r) => r.status === 200 && r.json('results.0.outcome') === 'accepted',
  });
}

export function parent() {
  const who = parents[exec.scenario.iterationInTest % parents.length];
  const p = as(who);
  const home = http.get(`${API}/parent/home`, {
    ...p,
    tags: { kind: 'read', name: 'parent home' },
  });
  check(home, { 'home 200': (r) => r.status === 200 });
  const msgs = http.get(`${API}/parent/messages?childId=${who.childId}`, {
    ...p,
    tags: { kind: 'read', name: 'parent messages' },
  });
  check(msgs, { 'messages 200': (r) => r.status === 200 });
}
