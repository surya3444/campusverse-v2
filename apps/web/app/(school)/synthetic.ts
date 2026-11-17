// SYNTHETIC DATA for design review. Invented school, people and numbers; nothing here is real.
// Replaced by API data once the school modules exist.
import type {
  DayLineBlock,
  DayLineMarker,
  GridColumn,
  GridRow,
  ScopeOption,
} from '@campusverse/ui';

export const defaultScope: ScopeOption = {
  id: 'north-vps',
  campus: 'North Campus',
  institution: 'Synthetic Vidya Public School',
  year: '2026–27',
};

export const scopes: ScopeOption[] = [
  defaultScope,
  { ...defaultScope, id: 'north-vps-25', year: '2025–26' },
  {
    id: 'south-vjc',
    campus: 'South Campus',
    institution: 'Synthetic Vidya Junior School',
    year: '2026–27',
  },
];

export const blocks: DayLineBlock[] = [
  {
    id: 'bus-in',
    lane: 'transport',
    label: 'Morning buses · 14 of 14 in',
    start: '07:00',
    end: '08:15',
    tone: 'go',
  },
  { id: 'bus-out', lane: 'transport', label: 'Afternoon buses', start: '14:50', end: '16:10' },
  {
    id: 'register',
    lane: 'attendance',
    label: 'Register · 38 of 42 marked',
    start: '08:15',
    end: '09:30',
    tone: 'stop',
  },
  { id: 'p1-4', lane: 'classes', label: 'Periods 1–4', start: '08:30', end: '11:50' },
  { id: 'lunch', lane: 'classes', label: 'Lunch', start: '11:50', end: '12:30' },
  { id: 'p5-8', lane: 'classes', label: 'Periods 5–8', start: '12:30', end: '14:40' },
  {
    id: 'marks',
    lane: 'assessment',
    label: 'Unit test 1 marks open',
    start: '10:00',
    end: '16:00',
  },
  { id: 'gate-in', lane: 'gate', label: 'Arrival', start: '07:30', end: '08:30', tone: 'go' },
  {
    id: 'pickup',
    lane: 'gate',
    label: 'Dismissal & pickup',
    start: '14:40',
    end: '15:20',
    tone: 'warn',
  },
];

export const markers: DayLineMarker[] = [
  {
    id: 'm-unmarked',
    at: '09:30',
    label: '4 sections unmarked',
    tone: 'stop',
    attentionId: 'unmarked',
  },
  { id: 'm-absent', at: '09:45', label: '2 teachers absent', tone: 'warn', attentionId: 'cover' },
  { id: 'm-leave', at: '11:00', label: '3 leave requests', tone: 'neutral', attentionId: 'leave' },
  { id: 'm-fees', at: '13:00', label: 'Fees due: 38 families', tone: 'warn' },
  { id: 'm-staff', at: '16:30', label: 'Staff meeting', tone: 'neutral' },
];

export const unmarkedSections = [
  { section: '6-B', teacher: 'Ms. Kavya Synthetic' },
  { section: '7-A', teacher: 'Mr. Arjun Synthetic' },
  { section: '8-C', teacher: 'Mr. Ravi Synthetic' },
  { section: '9-A', teacher: 'Ms. Meera Synthetic' },
];
export const absentTeacher = { name: 'Mr. Ravi Synthetic', section: '8-C' };

export const coverPeriods = [
  { period: 'Period 3 · 10:20', section: '8-C', subject: 'Science' },
  { period: 'Period 4 · 11:05', section: '9-A', subject: 'Science' },
  { period: 'Period 6 · 13:10', section: '7-A', subject: 'Mathematics' },
];

export const today = {
  marked: 38,
  sections: 42,
  present: 1184,
  enrolled: 1262,
  collected: 124500,
  dueFamilies: 38,
  leaveRequests: 3,
};

export const students = [
  {
    id: 's1',
    name: 'Aanya Synthetic',
    klass: '5-A',
    roll: 1,
    guardian: 'Priya Synthetic (mother)',
    attendance: '96%',
  },
  {
    id: 's2',
    name: 'Bharath Synthetic',
    klass: '5-A',
    roll: 2,
    guardian: 'Suresh Synthetic (father)',
    attendance: '91%',
  },
  {
    id: 's3',
    name: 'Chitra Synthetic',
    klass: '5-A',
    roll: 3,
    guardian: 'Lakshmi Synthetic (mother)',
    attendance: '88%',
  },
  {
    id: 's4',
    name: 'Dev Synthetic',
    klass: '5-A',
    roll: 4,
    guardian: 'Anil Synthetic (father)',
    attendance: '74%',
  },
  {
    id: 's5',
    name: 'Esha Synthetic',
    klass: '5-A',
    roll: 5,
    guardian: 'Rekha Synthetic (guardian)',
    attendance: '99%',
  },
  {
    id: 's6',
    name: 'Farhan Synthetic',
    klass: '5-A',
    roll: 6,
    guardian: 'Imran Synthetic (father)',
    attendance: '93%',
  },
];

export const markColumns: GridColumn[] = [
  { id: 'written', header: 'Written', max: 40 },
  { id: 'oral', header: 'Oral', max: 10 },
  { id: 'project', header: 'Project', max: 20 },
];

const MARKS = [
  { written: '34', oral: '8', project: '17' },
  { written: '29.5', oral: '9', project: '' },
  { written: 'AB', oral: '', project: '15' },
  { written: '41', oral: '7', project: '12' },
  { written: '', oral: '', project: '' },
  { written: '38', oral: 'ten', project: '19' },
];

export const markRows: GridRow[] = students.map((s, i) => ({
  id: s.id,
  name: s.name,
  meta: `Roll ${s.roll}`,
  values: MARKS[i] ?? {},
}));
