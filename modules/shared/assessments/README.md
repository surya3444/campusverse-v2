# shared/assessments

Academics › Assessments for any institution type (rule book §13.2: Question Bank, Quizzes & Tests;
docs/specs/ASSESSMENTS.md). The CIE plan and gradebook with locks live in academics/exams.

| Use case                                                                     | What                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `subjects`, `questions`, `saveQuestion`, `archiveQuestion`                   | The bank: MCQ, short and long questions with marks, difficulty, Bloom level and an optional CO code                    |
| `papers`, `createPaper`, `paperDetail`, `setPaperQuestions`, `finalisePaper` | Papers built from the bank, each question copied as it was; blueprint by Bloom, difficulty and CO; final papers frozen |

All need `assessment.bank.manage`. **Owns:** `assessment_question`, `assessment_paper`,
`assessment_paper_item` (migration 0087). **Events:** none yet.
