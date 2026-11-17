// How-to articles for the help.search tool: short, linked to the screen, no school data.
import { z } from 'zod';
import { defineTool } from './tool.js';

type Article = { id: string; title: string; keywords: string[]; steps: string[]; href: string };

export const ARTICLES: Article[] = [
  {
    id: 'take-attendance',
    title: 'Take attendance',
    keywords: ['attendance', 'mark', 'absent', 'register', 'present'],
    steps: [
      'Open Attendance and choose your section.',
      'Everyone starts present: tap the students who are absent or late.',
      'Submit. It works offline and syncs when you reconnect.',
    ],
    href: '/attendance',
  },
  {
    id: 'issue-tc',
    title: 'Issue a transfer certificate',
    keywords: ['tc', 'transfer', 'certificate', 'leaving', 'leave school'],
    steps: [
      'Open Certificates and choose Request a certificate.',
      'Find the student, choose Transfer certificate, and enter the leaving date and reason.',
      'The class teacher checks it, the principal approves, then Issue creates the numbered PDF with a QR code.',
    ],
    href: '/certificates',
  },
  {
    id: 'send-notice',
    title: 'Send a notice to parents',
    keywords: ['notice', 'circular', 'message', 'parents', 'announce', 'holiday'],
    steps: [
      'Open Notices and choose New notice.',
      'Write the title and message, and choose who receives it.',
      'Send for approval; the principal approves and it goes out in the parent app.',
    ],
    href: '/notices/new',
  },
  {
    id: 'collect-fee',
    title: 'Collect a fee at the counter',
    keywords: ['fee', 'fees', 'collect', 'receipt', 'payment', 'cash', 'dues'],
    steps: [
      'Open Fees and search for the student.',
      'Choose Collect, enter the amount and mode, and save.',
      'A numbered receipt is created and can be printed or shared.',
    ],
    href: '/fees',
  },
  {
    id: 'enter-marks',
    title: 'Enter exam marks',
    keywords: ['marks', 'exam', 'grade', 'result', 'report card', 'publish'],
    steps: [
      'Open Exams, choose the exam, then the subject and section.',
      'Type marks into the grid (AB for absent). It saves as you type.',
      'Submit the subject. When every subject is in, the exam is locked and published with report cards.',
    ],
    href: '/exams',
  },
  {
    id: 'year-end',
    title: 'Promote students to the next year',
    keywords: ['promote', 'promotion', 'rollover', 'next year', 'year end', 'sections'],
    steps: [
      'Set up next year’s classes and sections in Setup.',
      'Open Year end, review each student’s outcome and plan sections.',
      'Roll over. You can undo until the new year is used.',
    ],
    href: '/year-end',
  },
  {
    id: 'admit-student',
    title: 'Admit a new student',
    keywords: ['admission', 'admit', 'enquiry', 'new student', 'apply'],
    steps: [
      'Open Admissions and add the enquiry.',
      'Move it through application and offer; the offer shows the fee plan.',
      'Enrol to create the student, their class place and parent access.',
    ],
    href: '/admissions',
  },
];

export const helpSearch = defineTool({
  name: 'help.search',
  description:
    'Find how-to articles for doing something in Campusverse. Use for "how do I…" questions. Returns steps and the screen link.',
  permission: null,
  risk: 'read',
  dataClasses: ['public'],
  input: z.object({ query: z.string().min(1).max(200) }),
  handler: async (ctx, { query }) => {
    const words = query.toLowerCase();
    const found = ARTICLES.map((a) => ({
      a,
      score: a.keywords.filter((k) => words.includes(k)).length,
    }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 2)
      .map((x) => x.a);
    return {
      data: found.map(({ title, steps, href }) => ({ title, steps, href })),
      sources: found.map((a) => ({ label: a.title, href: a.href, asOf: ctx.today })),
    };
  },
});
