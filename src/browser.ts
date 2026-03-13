import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const SESSION_DIR = path.join(os.homedir(), ".coupang-session");
const SCREENSHOT_DIR = path.join(SESSION_DIR, "screenshots");
const CDP_PORT = 9222;

export function getSessionDir(): string {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  return SESSION_DIR;
}

function getScreenshotDir(): string {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
  return SCREENSHOT_DIR;
}

export async function saveSession(context: BrowserContext): Promise<void> {
  const storageStatePath = path.join(getSessionDir(), "storage-state.json");
  await context.storageState({ path: storageStatePath });
}

export async function clearSession(): Promise<void> {
  const storageStatePath = path.join(getSessionDir(), "storage-state.json");
  if (fs.existsSync(storageStatePath)) {
    fs.unlinkSync(storageStatePath);
  }
}

/** 랜덤 딜레이 (자연스러운 행동 모방) */
export function randomDelay(min = 500, max = 2000): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 스크린샷 저장 및 경로 반환 */
export async function takeScreenshot(page: Page, name: string): Promise<string> {
  const dir = getScreenshotDir();
  const filePath = path.join(dir, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

/** 자연스러운 스크롤: PageDown 여러 번 + 마지막은 End 키 */
export async function naturalScroll(page: Page, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press("PageDown");
    await randomDelay(800, 1500);
  }
  await page.keyboard.press("End");
  await randomDelay(500, 1000);
}

/** macOS에서 Chrome 경로 찾기 */
function findChromePath(): string {
  const paths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome이 설치되어 있지 않습니다.");
}

/** 이미 CDP 포트에 Chrome이 떠있는지 확인 */
async function isChromeRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Chrome을 서브프로세스로 직접 실행 (Playwright가 아닌 실제 Chrome) */
async function launchChromeSubprocess(): Promise<ChildProcess | null> {
  if (await isChromeRunning()) {
    return null; // 이미 실행 중
  }

  const chromePath = findChromePath();
  const userDataDir = path.join(getSessionDir(), "chrome-user-data");

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1920,1080",
  ], {
    stdio: "ignore",
    detached: true,
  });

  // Chrome이 뜰 때까지 대기
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isChromeRunning()) break;
  }

  if (!(await isChromeRunning())) {
    throw new Error("Chrome 실행 실패");
  }

  return chromeProcess;
}

/**
 * 실제 Chrome을 서브프로세스로 띄우고 CDP로 연결
 * - 블로그 권장: "크로미움을 서브프로세스로 먼저 띄우고 연결하는 방식"
 * - HTTP/2 핑거프린팅 우회
 */
export async function withBrowser<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
  _headless = false, // 무시 — 항상 실제 Chrome UI
): Promise<T> {
  const chromeProcess = await launchChromeSubprocess();

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] ?? await browser.newContext();

  // navigator.webdriver = false
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });
  });

  const page = await context.newPage();

  try {
    const result = await fn(page, context);
    return result;
  } finally {
    await page.close();
    // Chrome은 계속 살려둠 (세션 유지)
    browser.close();
  }
}
