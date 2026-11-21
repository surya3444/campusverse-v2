# shared/surveys

Academics › Feedback & Surveys for any institution type (rule book §13.4; docs/specs/SURVEYS.md).
Audiences checked through people/records (`memberKind`, `isGuardianAt`).

| Use case                                                    | What                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `surveys`, `createSurvey`, `setQuestions`, `setSurveyState` | Surveys from templates; questions while a draft; open, then close (`survey.form.manage`)                       |
| `surveysToAnswer`, `submitResponse`                         | Open surveys for the person's audience within dates; answered once; anonymous unless the survey says otherwise |
| `surveyResults`, `addAction`, `completeAction`              | Averages, counts, comments, weighted score; actions with owners and outcomes (the action-taken report)         |

**Owns:** `survey`, `survey_question`, `survey_receipt`, `survey_response`, `survey_answer`,
`survey_action` (migration 0086). **Events:** none yet.
