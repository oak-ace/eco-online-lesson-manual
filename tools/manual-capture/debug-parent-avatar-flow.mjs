#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const artifactsRoot = path.join(__dirname, ".artifacts");
const trackedFixtureSummaryPath = path.join(
  __dirname,
  "dev-image-fixtures-summary.json",
);
const artifactFixtureSummaryPath = path.join(
  artifactsRoot,
  "dev-image-fixtures-summary.json",
);
const fixtureStatePath = path.join(
  __dirname,
  ".state",
  "dev-image-fixtures.state.json",
);

const loadJson = (targetPath) => {
  try {
    return JSON.parse(readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
};

const fixtureSummary =
  loadJson(trackedFixtureSummaryPath) ?? loadJson(artifactFixtureSummaryPath);
const fixtureState = loadJson(fixtureStatePath);
const parentEmail =
  fixtureSummary?.students?.[0]?.parent?.email ??
  fixtureSummary?.students?.find((student) => student?.parent?.email)?.parent?.email ??
  process.env.E2E_PARENT_EMAIL ??
  "";
const password = process.env.E2E_LOGIN_PASSWORD ?? "";
const baseUrl = process.env.ECO_BASE_URL ?? "";
const fixturePrimaryClassId = fixtureState?.classes?.primary?.classId ?? null;
const fixturePrimaryStudentId =
  fixtureSummary?.students?.[0]?.studentId ??
  Object.values(fixtureState?.students ?? {})[0]?.studentId ??
  null;

if (!baseUrl || !parentEmail || !password) {
  throw new Error(
    "ECO_BASE_URL, E2E_LOGIN_PASSWORD, and fixture parent email are required.",
  );
}

const runStartedAt = new Date();
const runSlug = runStartedAt.toISOString().replaceAll(":", "").replace(/\..+/, "");
const runDir = path.join(artifactsRoot, `parent-avatar-debug-${runSlug}`);
const manifestPath = path.join(runDir, "manifest.json");
const reportPath = path.join(runDir, "report.md");
const htmlSnapshotsDir = path.join(runDir, "html");
const startedMs = Date.now();
const manifest = [];
let screenshotIndex = 0;

const elapsedMs = () => Date.now() - startedMs;

const padElapsed = (value) => String(value).padStart(6, "0");

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "capture";

const waitForSettledDom = async (page, delayMs = 1_000) => {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(delayMs);
};

const writeManifest = async () => {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
};

const capturePoint = async (page, label, details = {}) => {
  screenshotIndex += 1;
  const elapsed = elapsedMs();
  const fileBase = `${padElapsed(elapsed)}ms-${String(screenshotIndex).padStart(2, "0")}-${slugify(label)}`;
  const imageName = `${fileBase}.png`;
  const htmlName = `${fileBase}.html`;
  const imagePath = path.join(runDir, imageName);
  const htmlPath = path.join(htmlSnapshotsDir, htmlName);
  await page.screenshot({ path: imagePath, fullPage: true });
  const html = await page.content().catch(() => "");
  await writeFile(htmlPath, html, "utf8");
  const entry = {
    index: screenshotIndex,
    elapsedMs: elapsed,
    label,
    imageName,
    htmlName,
    url: page.url(),
    title: await page.title().catch(() => ""),
    ...details,
  };
  manifest.push(entry);
  await writeManifest();
  return entry;
};

const noteError = (error) =>
  error instanceof Error ? error.message : String(error);

const applyHomeContext = async (page) => {
  await page.evaluate(
    ({ classId, studentId }) => {
      window.localStorage.setItem("eco:deviceMode", "home");
      if (classId) {
        window.localStorage.setItem("eco:selectedClassId", classId);
      }
      if (studentId) {
        window.localStorage.setItem("eco:selectedStudentId", studentId);
      }
    },
    {
      classId: fixturePrimaryClassId,
      studentId: fixturePrimaryStudentId,
    },
  );
};

const run = async () => {
  await mkdir(runDir, { recursive: true });
  await mkdir(htmlSnapshotsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
  });
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await waitForSettledDom(page);
    await capturePoint(page, "login-page-loaded", {
      step: "parent:login-page",
    });

    await capturePoint(page, "before-fill-email", {
      step: "parent:login",
      action: "fill email",
      phase: "before",
    });
    await page.locator('input[type="email"]').fill(parentEmail);
    await capturePoint(page, "after-fill-email", {
      step: "parent:login",
      action: "fill email",
      phase: "after",
    });

    await capturePoint(page, "before-fill-password", {
      step: "parent:login",
      action: "fill password",
      phase: "before",
    });
    await page.locator('input[type="password"]').fill(password);
    await capturePoint(page, "after-fill-password", {
      step: "parent:login",
      action: "fill password",
      phase: "after",
    });

    await capturePoint(page, "before-click-login", {
      step: "parent:login",
      action: "click login",
      phase: "before",
    });
    await page.locator('button[type="submit"]').click();
    await waitForSettledDom(page, 2_000);
    await capturePoint(page, "after-click-login", {
      step: "parent:login",
      action: "click login",
      phase: "after",
    });

    if (/\/login\b/.test(page.url())) {
      const hasAccessToken = await page.evaluate(
        () =>
          typeof window.localStorage.getItem("eco:authAccessToken") === "string" &&
          window.localStorage.getItem("eco:authAccessToken").length > 0,
      );
      await capturePoint(page, "login-still-open", {
        step: "parent:login",
        result: "still-on-login",
        hasAccessToken,
      });
      if (hasAccessToken) {
        await applyHomeContext(page);
        await capturePoint(page, "after-apply-home-context", {
          step: "parent:login",
          action: "apply home context",
        });
        await page.goto(`${baseUrl}/home`, { waitUntil: "domcontentloaded" });
        await waitForSettledDom(page, 2_000);
        await capturePoint(page, "after-force-home-navigation", {
          step: "parent:login",
          action: "force goto /home",
        });
      }
    }

    await page.goto(`${baseUrl}/switch-student`, { waitUntil: "domcontentloaded" });
    await waitForSettledDom(page);
    await capturePoint(page, "switch-student-loaded", {
      step: "parent:home-startup",
    });

    const startButton = page.getByRole("button", { name: /^Start$/i });
    if (await startButton.isVisible().catch(() => false)) {
      await capturePoint(page, "before-click-start", {
        step: "parent:home-startup",
        action: "click start",
        phase: "before",
      });
      try {
        await startButton.click({ timeout: 30_000 });
        await waitForSettledDom(page, 2_000);
        await capturePoint(page, "after-click-start", {
          step: "parent:home-startup",
          action: "click start",
          phase: "after",
        });
      } catch (error) {
        await capturePoint(page, "start-click-failed", {
          step: "parent:home-startup",
          action: "click start",
          result: "failed",
          error: noteError(error),
        });
      }
    } else {
      await capturePoint(page, "start-button-not-visible", {
        step: "parent:home-startup",
        result: "start-button-not-visible",
      });
    }

    await capturePoint(page, "before-goto-mypage", {
      step: "parent:mypage",
      action: "goto /mypage",
      phase: "before",
    });
    await page.goto(`${baseUrl}/mypage`, { waitUntil: "domcontentloaded" });
    await waitForSettledDom(page, 2_000);
    try {
      await page.waitForURL(/\/mypage$/, { timeout: 30_000 });
      await capturePoint(page, "mypage-ready", {
        step: "parent:mypage",
        result: "ready",
      });
    } catch (error) {
      await capturePoint(page, "mypage-wait-failed", {
        step: "parent:mypage",
        result: "failed",
        error: noteError(error),
      });
    }

    await capturePoint(page, "before-goto-avatar", {
      step: "parent:avatar",
      action: "goto /avatar",
      phase: "before",
    });
    await page.goto(`${baseUrl}/avatar`, { waitUntil: "domcontentloaded" });
    await waitForSettledDom(page, 2_000);
    try {
      await page.waitForURL(/\/avatar$/, { timeout: 30_000 });
      await capturePoint(page, "avatar-ready", {
        step: "parent:avatar",
        result: "ready",
      });
    } catch (error) {
      await capturePoint(page, "avatar-wait-failed", {
        step: "parent:avatar",
        result: "failed",
        error: noteError(error),
      });
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  const lines = [
    "---",
    "title: Parent Avatar Debug",
    "lang: ja",
    "tag: debug",
    "---",
    "",
    "# Parent Avatar Debug",
    "",
    `Generated At: ${new Date().toISOString()}`,
    "",
    `Base URL: \`${baseUrl}\``,
    "",
    `Parent Email: \`${parentEmail}\``,
    "",
    "| # | Elapsed | Label | Step | URL | Result | Image |",
    "|---|---:|---|---|---|---|---|",
  ];

  for (const entry of manifest) {
    lines.push(
      `| ${entry.index} | ${entry.elapsedMs} ms | ${entry.label} | ${entry.step ?? ""} | ${entry.url} | ${entry.result ?? ""} | [${entry.imageName}](./${entry.imageName}) |`,
    );
    if (entry.error) {
      lines.push(`Error: \`${entry.error.replaceAll("|", "\\|")}\``);
    }
  }

  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ runDir, manifestPath, reportPath, captures: manifest.length }, null, 2));
};

await run();
