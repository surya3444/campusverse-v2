import { describe, expect, it } from 'vitest';
import { dayLabel, myLessons, type DayLesson } from './lessons';
import { MESSAGES } from './messages';

const l = (
  slotId: string,
  teacher: string | null,
  cover: DayLesson['cover'] = null,
): DayLesson => ({
  slotId,
  ordinal: 1,
  startsAt: '09:00',
  endsAt: '09:40',
  section: 'Class 5-A',
  subject: 'English',
  teacherPersonId: teacher,
  room: null,
  cover,
});

describe('lessons', () => {
  it('keeps my lessons unless covered, and the ones I cover', () => {
    const all = [
      l('a', 'me'),
      l('b', 'me', { kind: 'teacher', personId: 'other' }),
      l('c', 'other', { kind: 'teacher', personId: 'me' }),
      l('d', 'other'),
    ];
    expect(myLessons(all, 'me').map((x) => x.slotId)).toEqual(['a', 'c']);
  });
  it('labels days', () => {
    const t = MESSAGES.en;
    expect(dayLabel(t, '2026-11-09', '2026-11-09')).toBe('Today');
    expect(dayLabel(t, '2026-11-10', '2026-11-09')).toBe('Tuesday 10');
  });
});
