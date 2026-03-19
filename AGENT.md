# AGENT.md

## Purpose

This repository is for building CI-oriented scripts and related assets that:

- capture the latest screens from the ECO Online Lesson application
- regenerate the latest user manual as the app evolves
- publish the generated manual to GitHub Pages

The intended workflow is to re-run screen capture and manual generation against the latest app state, then publish the refreshed output automatically.

## Current Manual Repository

- Repository: `eco-online-lesson-manual`
- Current purpose text from `README.md`: `Publication of the eco-online-lesson manual`

This repository was initially almost empty and is currently being used as the automation/manual-publication side of the project.

## Planned Repository Structure

The planned structure for this repository is:

```text
.
├── tools/
│   └── manual-capture/
├── docs/
│   ├── _config.yml
│   ├── index.md
│   ├── ja/
│   │   ├── index.md
│   │   └── manual/
│   │       ├── index.md
│   │       ├── login.md
│   │       ├── teacher/
│   │       │   ├── index.md
│   │       │   └── open-class.md
│   │       └── student/
│   │           ├── index.md
│   │           └── join-class.md
│   ├── en/
│   │   ├── index.md
│   │   └── manual/
│   │       ├── index.md
│   │       ├── login.md
│   │       ├── teacher/
│   │       │   ├── index.md
│   │       │   └── open-class.md
│   │       └── student/
│   │           ├── index.md
│   │           └── join-class.md
│   └── assets/
│       └── images/
└── .github/
    └── workflows/
        └── pages.yml
```

Interpretation:

- `tools/manual-capture` will hold the automation and capture scripts
- `docs` will be the GitHub Pages publication root
- manuals will be bilingual:
  - `docs/ja/...`
  - `docs/en/...`
- images are language-independent shared assets
- image storage should be treated as common assets under:
  - `docs/assets/images/common`
- `.github/workflows/pages.yml` is expected to publish the generated site

Implication for future implementation:

- generated markdown should be separated by language
- captured screenshots should be reusable across languages
- manual page generation should reference common image paths instead of duplicating language-specific copies

## Upstream Application Repository

- Environment variable: `GIT_REPOSITORY_URL=https://github.com/oak-ace/eco-online-lesson`
- Relevant branch: `develop`
- Verified branch HEAD during investigation: `0b6c0ee`

For source investigation, the upstream repository was fetched sparsely to inspect:

- `.agent/rules`
- `apps/lesson`
- `apps/lesson/tests/playwright`

Note:

- There was no top-level `e2e/` directory in the fetched scope.
- The practical E2E assets used for understanding flows are under `apps/lesson/tests/playwright`.

## Main Target Application Area

The main app code for the manual target is:

- `apps/lesson`

Design documents are mainly under:

- `.agent/rules`

Important design references discovered during investigation:

- `.agent/rules/application-startup.md`
- `.agent/rules/lesson-app-design.md`
- `.agent/rules/lesson-gates-design.md`
- `.agent/rules/auth-session-design.md`
- `.agent/rules/user-context-design.md`
- `.agent/rules/eco-online-application.md`

## Confirmed Environment Variables

These variables were present in the session when investigated:

- `ECO_BASE_URL=https://develop.d1ldclq3p5i259.amplifyapp.com`
- `E2E_TEACHER_EMAIL=teacher@ace-software.com`
- `E2E_PARENT_EMAIL=parent@ace-software.com`
- `E2E_LOGIN_PASSWORD` was set
- `AWS_PROFILE=eco-online-dev`

## AWS Access Status

The user stated that:

- GitHub CLI is installed
- AWS CLI is installed
- AWS SSO authentication will be prepared by the user when needed

AWS profile access was verified with:

- `AWS_PROFILE=eco-online-dev`
- `aws sts get-caller-identity --profile "$AWS_PROFILE"`

Observed identity at investigation time:

- Account: `070638634946`
- ARN: `arn:aws:sts::070638634946:assumed-role/AWSReservedSSO_AdministratorAccess2_0f404058f7c78c75/her-hoshino`

## Login Verification Already Performed

Access was tested against `ECO_BASE_URL` using Playwright-style browser automation.

### Parent account

- Account: `E2E_PARENT_EMAIL`
- Password: `E2E_LOGIN_PASSWORD`
- Result: login succeeded
- Observed post-login URL: `/switch-student`
- Observed screen content included `Welcome eco-online!`

Interpretation:

- parent authentication works
- the account can proceed into the normal student/home flow

### Teacher account

- Account: `E2E_TEACHER_EMAIL`
- Password: `E2E_LOGIN_PASSWORD`
- Result: authentication appears valid, but app usage was blocked
- Observed post-login URL: `/restricted`
- Observed message:
  - `This device is set up for home use. This user teacher@ace-software.com cannot use it.`

Interpretation:

- credentials appear valid
- the tested entry path / device mode was not allowed for that teacher account in that environment

## Product Goal Clarified by User

The user clarified that the goal is not only to explore the app, but to build script groups for CI that can:

1. re-fetch the current state of the application
2. capture updated screens
3. regenerate the latest manual
4. publish the result to GitHub Pages

This goal should guide future work in this repository.

## High-Level App Behavior Confirmed

The ECO Online Lesson app is organized around device modes and gate-based startup.

### Device modes

From design and implementation:

- `teacher`
- `home`
- `shared`

### Gate sequence

The startup flow is defined as:

1. `DeviceModeGate`
2. `AuthGate`
3. `RoleGate`
4. `SubjectGate`
5. `FeatureGate`
6. `SharedLicenseGate` at join timing

This is defined in `.agent/rules/application-startup.md` and implemented in `apps/lesson/src/layouts/RootGateLayout.tsx`.

### Role model

App-level role interpretation:

- Cognito `teacher` -> app role `teacher`
- Cognito `parent` -> app role `student`

Other roles are restricted.

### Lesson participation model

- teacher acts as host
- student/home/shared flows act as client participants
- Sync session is mounted only under session routes

## Important Routes and Screens

### Entry and common pages

- `/setup-device`
- `/login`
- `/restricted`

### Selection flow pages

- `/select-class`
- `/select-student`
- `/switch-student`

### Startup pages

- `/home/lesson`
- `/teacher/lesson`
- `/shared/lesson`

### Profile-related pages

- `/mypage`
- `/avatar`

### Lesson session pages

- `/{mode}/lesson/:lessonId/session`
- `/{mode}/lesson/:lessonId/session/content/:contentId`

### Dialog-like manual targets without dedicated routes

These are important for manual generation even though they are not independent route pages:

- `Start Lesson`
- `Enter Lesson`
- `End Lesson`
- `Exit Lesson`
- `Leave Lesson`
- `MyPageDialog`

This means future screenshot/manual automation should distinguish:

- route pages
- route-independent modal/dialog states

## Confirmed Transition Sequences

### Teacher sequence

Typical flow:

1. `/teacher`
2. `/login`
3. possibly `/select-class`
4. `/teacher/lesson`
5. `Start Lesson` or `Join Lesson`
6. `/teacher/lesson/:lessonId/session`
7. `/teacher/lesson/:lessonId/session/content/:contentId`
8. `End Lesson`
9. `/select-class`

Implementation signals:

- `apps/lesson/src/pages/preview/PreviewPage.tsx`
- `apps/lesson/src/routes/lesson/LessonSessionLayout.tsx`

### Home sequence

Typical flow:

1. `/home`
2. `/login`
3. possibly `/switch-student`
4. `/home/lesson`
5. `My Progress` -> `/mypage`
6. `/mypage` -> `/avatar` if avatar editing is used
7. `Enter Lesson`
8. `/home/lesson/:lessonId/session`
9. `/home/lesson/:lessonId/session/content/:contentId`
10. after teacher ends lesson, `Lesson Finished`
11. back to `/home/lesson`

Implementation signals:

- `apps/lesson/src/pages/homework/HomeworkPage.tsx`
- `apps/lesson/src/pages/mypage/StudentProfilePage.tsx`

### Shared sequence

Typical flow:

1. `/shared`
2. `/login`
3. `/select-class`
4. `/select-student`
5. `/shared/lesson`
6. `Enter Lesson`
7. `/shared/lesson/:lessonId/session`

Design and test signals:

- `.agent/rules/application-startup.md`
- `apps/lesson/tests/playwright/login-real-sandbox.e2e.ts`

### Restricted flow

Triggered when:

- role is not allowed for device mode
- feature is not allowed in current mode

Examples:

- teacher trying to use a home-only path
- disallowed profile/avatar access depending on mode

## E2E / Playwright Knowledge Gathered

Important real-environment Playwright tests:

- `apps/lesson/tests/playwright/login-real-sandbox.e2e.ts`
- `apps/lesson/tests/playwright/lesson-sequence-real-sandbox.e2e.ts`

These tests are useful as the best current machine-readable descriptions of:

- login flows
- class/student selection flows
- startup readiness
- lesson start/join/end behavior

Key points learned from tests:

- teacher may land on `/select-class` before startup
- home may land on `/switch-student` before startup
- shared may land on `/select-class` and then `/select-student`
- real sandbox sequence test covers:
  - teacher starts lesson
  - home joins lesson
  - teacher ends lesson
  - home sees `Lesson Finished` and exits

## Automation Implications for This Manual Repo

Future CI/manual generation work likely needs:

- a stable screen inventory
- a stable transition inventory
- deterministic capture entrypoints
- account/data fixtures suitable for capture
- a decision on whether to capture:
  - against real sandbox/server state
  - against Playwright mocks for repeatability
  - or a hybrid of both

The user explicitly wants CI script groups, so future tasks should prioritize:

- reproducibility
- low-maintenance screen capture flows
- compatibility with GitHub Actions
- publishable GitHub Pages outputs

## Open Questions Already Identified

These questions were previously identified and remain unresolved:

1. Is the manual target only `apps/lesson`, or must `mypage` and `avatar` also be treated as first-class manual sections?
2. Should dialog states such as `Start Lesson` and `Enter Lesson` be included as manual pages?
3. Which environment should CI capture from: sandbox only, develop-like, production-like, or multiple environments?
4. Can stable dedicated capture accounts be prepared for teacher, parent, and shared flows?
5. Should teacher capture use a different account from the currently known restricted teacher account?
6. Should CI rely on real server state, mocked Playwright state, or both?
7. What is the desired GitHub Pages artifact format: static HTML, Markdown plus images, or generated site data?
8. What naming convention should be used for captured screens?
9. Should CI always regenerate everything, or publish only changed screens/manual sections?
10. How should credentials and environment configuration be stored in GitHub Actions?
11. Which AWS-side resources need inspection later: hosting, Cognito, fixture data, or something else?
12. Are masking/anonymization steps required before publishing screenshots?
13. Should CI capture all screens on every run, or only a selected scenario matrix?

## Guidance For Future Chats

When starting a new chat in this repository, assume:

- the repository is for automation/manual publication, not the main app itself
- the main source of truth for app behavior is the upstream `eco-online-lesson` repo, especially `develop`
- `apps/lesson` is the current main target
- Playwright-based flow automation is the most promising base for CI capture
- route pages and dialog states both matter for manual generation
- environment readiness may require GitHub CLI, AWS CLI, and `AWS_PROFILE=eco-online-dev`

If further environment inspection is needed, AWS access may be performed using:

- `AWS_PROFILE=eco-online-dev`
