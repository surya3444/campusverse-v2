// Shared bits of the Assessments screens. Constants are inlined: a value import from the module
// contract would pull server code into the browser.
import type { Bloom, Difficulty, QuestionKind } from '@campusverse/shared-assessments';
import { ApiFailure } from '../../../lib/api';
import { en } from '../../../messages/en';

export const t = en.assessments;
export const KINDS: QuestionKind[] = ['mcq', 'short', 'long'];
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const BLOOM: Bloom[] = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];
export const errorText = (e: unknown) =>
  (e instanceof ApiFailure ? t.errors[e.code] : undefined) ?? t.errors.error ?? '';
