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

## Confirmed Publishing Strategy

The user confirmed the intended publication flow:

- GitHub Actions will run on updates to the `main` branch
- on `main` branch registration/update, the documentation generation script will be executed
- the generated output will then be published to GitHub Pages

Practical implication:

- `main` is the publication branch for this repository
- manual generation should be executable in CI without manual local steps
- `.github/workflows/pages.yml` should eventually handle both:
  - document generation
  - GitHub Pages deployment

## Confirmed Manual Page Format

The user defined the default structure for manual pages.

### Front matter

Each manual page should start with front matter and include at least:

- `title`: page title
- `lang`: language code (`en` or `ja`)
- `tag`: classification tag
- `version`: target app software version

### Default page body structure

Manual pages should basically follow this order:

1. screen image
2. explanation of the image
3. list of items shown in the image
4. images for individual items that are not yet explained
5. explanations for those individual items

Interpretation for generation:

- section 3 should work as an item index for the main screenshot
- if an item has already been explained elsewhere, link to that explanation instead of duplicating it
- only include additional per-item screenshots for items not yet explained sufficiently by the main image and text

### Required explanation content

Explanations should include the following when applicable:

- the purpose of the displayed information
- the meaning of each state shown in the displayed information, if state variations exist
- the operation method and its effect, if the UI allows operation
- the conditions under which operation is possible, if operation and conditions exist

Implication for future automation:

- generated markdown should likely use a stable section template
- screenshot capture should support both:
  - whole-screen images
  - cropped or focused images for individual items
- content generation should be aware of cross-page linking so that repeated explanations can be linked instead of duplicated

### Link rules

- links to directories should not rely on implicit directory resolution
- always link explicitly to `index.md`
- examples:
  - use `./manual/index.md` instead of `./manual/`
  - use `/ja/index.md` instead of `/ja/`

- when the destination screen is already known and that destination screen has its own manual page, the source page should include a markdown link to that destination page
- this applies especially to:
  - startup transitions
  - selection flows
  - menu-driven page transitions

Implication for generation:

- manual pages should prefer explicit inter-page navigation where the next documented page is known
- index generation should always output explicit `index.md` targets

## Confirmed Generation And Capture Rules

The following operational rules were confirmed by the user.

### Source of truth for captured screens

- current manual screenshots are captured from the real application in a browser via Playwright automation
- repeatability is still important, so capture logic should wait on stable screen signals instead of fixed delays
- Playwright mocks remain a possible future technique for some scenarios, but they are not the current default

### Scope of manual targets

- ultimately, all screens are in scope
- during implementation work, the actual target subset may be specified task-by-task by the user

Implication:

- tooling should support partial local generation for selected screens or flows
- CI should still support full output generation

### Full regeneration vs partial regeneration

- GitHub Actions should regenerate all screens and documents
- local work only needs to generate the explicitly requested portion

### Version source

- the manual `version` field should be sourced from `apps/lesson/package.json`

### Language generation policy

- GitHub Actions should generate both Japanese and English outputs
- during local work, if not otherwise instructed, Japanese-only output is sufficient
- Japanese context files under `tools/manual-capture/context/ja/` are the source of truth for explanation intent
- English manual generation should also read that Japanese context as its base input
- if English-specific overrides are ever needed, they should be additive and not replace Japanese context as the primary source
- context files are authoring inputs for Codex and generator logic, not content that must be emitted verbatim into the final manual
- output manual filenames should use English slugs even for Japanese pages
- avoid Japanese characters in generated manual filenames; localize titles and headings inside markdown instead

### Markdown editing policy

- direct manual edits to generated markdown are not the default
- if hand-authored content is required, it should live in a separate markdown file
- generated markdown should include that separate file rather than being edited directly

Implication:

- generated files should remain replaceable
- hand-maintained content should be isolated in include-friendly companion files

### Personal information policy

- masking of personal information and environment-specific display is not required
- the manual is intended for internal team use

### CI failure policy

- it is sufficient that failed capture points are identifiable
- failure handling should be controlled as much as possible on the output/generation side

Implication:

- future scripts should aim to:
  - continue collecting successful outputs when possible
  - clearly report failed screens or steps
  - make it easy to understand what was not captured

### Unknown-items lifecycle

- once an item in `README.md` -> `不明点` is resolved:
  - if it should remain reusable, it should be transferred to a durable place such as `AGENT.md` or the relevant script
  - then it should be removed from `README.md`
- if it is no longer needed after resolution, it can simply be removed

## Proposed Screenshot Naming Rule

To satisfy the requirement for a uniquely definable naming rule, use the following convention unless a future task explicitly changes it.

### Common principles

- use lowercase kebab-case only
- names should be deterministic from the logical manual target
- separate:
  - full-screen captures
  - focused item captures
  - language-independent common assets
- avoid embedding natural-language UI labels directly when a stable route/state identifier exists

### Base directory

- common screenshots:
  - `docs/assets/images/common/`

### Full-screen captures

Format:

- `screen-{flow}-{page}.png`
- `screen-{flow}-{page}--{state}.png`

Examples:

- `screen-common-login.png`
- `screen-teacher-startup.png`
- `screen-home-startup--in-progress.png`
- `screen-shared-select-student.png`
- `screen-home-mypage.png`
- `screen-home-avatar.png`
- `screen-teacher-session-content.png`

### Item-level captures

Format:

- `item-{flow}-{page}-{item}.png`
- `item-{flow}-{page}-{item}--{state}.png`

Examples:

- `item-common-login-email-field.png`
- `item-common-login-password-field.png`
- `item-teacher-startup-start-lesson-button.png`
- `item-home-mypage-avatar-panel.png`

### Dialog captures

Treat dialogs as explicit page states:

- `screen-{flow}-{page}--dialog-{dialog-name}.png`

Examples:

- `screen-teacher-startup--dialog-start-lesson.png`
- `screen-home-startup--dialog-enter-lesson.png`
- `screen-teacher-session--dialog-end-lesson.png`

### Identifier guidance

- `flow` should be one of:
  - `common`
  - `teacher`
  - `home`
  - `shared`
  - or another stable scenario key if future tooling needs it
- `page` should be a stable manual page identifier, not necessarily the raw route
- `state` should be used only when the same page has materially different manual states
- `item` should be a stable semantic identifier of the UI element

### Version handling

- do not embed app version in screenshot filenames by default
- version belongs in markdown front matter and generation metadata
- filenames should stay stable across releases so references are easy to maintain

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

## Confirmed Working Rule For Unknown Information

The user requested the following rule for future tool and script implementation work:

- if required information is missing while creating outputs or scripts, do not leave it only in the chat response
- also record it in `README.md` under a section named `不明点`
- items in `不明点` should be maintained as a list

Purpose of this rule:

- prevent information loss when work is interrupted unexpectedly
- reduce the risk of overlooked unresolved questions
- keep ambiguous points visible until they are clarified

Operational expectation:

- whenever a future task reveals a blocker, ambiguity, or required decision, update:
  - the chat response
  - `README.md` -> `不明点`
