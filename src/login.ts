import type { Page, BrowserContext } from "playwright";
import { withBrowser, saveSession, getSessionDir, randomDelay } from "./browser.js";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import fs from "node:fs";

const COUPANG_LOGIN_URL = "https://login.coupang.com/login/login.pang";
const COUPANG_HOME_URL = "https://www.coupang.com/";

interface Credentials {
  email: string;
  password: string;
}

function loadCredentials(): Credentials | null {
  const credPath = path.join(getSessionDir(), "credentials.json");
  if (!fs.existsSync(credPath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    if (data.email && data.password) {
      return data as Credentials;
    }
    return null;
  } catch {
    return null;
  }
}

async function autoLogin(page: Page, credentials: Credentials): Promise<boolean> {
  try {
    await randomDelay(1000, 2000);
    await page.fill('input[name="email"], input#login-email-input', credentials.email);
    await randomDelay(500, 1000);
    await page.fill('input[name="password"], input#login-password-input', credentials.password);
    await randomDelay(500, 1000);
    await page.click('button[type="submit"], .login__button');

    await page.waitForURL((url) => !url.toString().includes("login.coupang.com"), {
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForManualLogin(page: Page): Promise<boolean> {
  console.log(
    chalk.yellow("\n🔐 브라우저에서 쿠팡에 로그인해주세요."),
  );
  console.log(chalk.gray("   로그인이 완료되면 자동으로 감지됩니다.\n"));

  try {
    await page.waitForURL((url) => !url.toString().includes("login.coupang.com"), {
      timeout: 300_000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function login(): Promise<void> {
  console.log(chalk.blue("\n쿠팡 로그인을 시작합니다..."));

  const credentials = loadCredentials();

  // 항상 브라우저 UI 표시 (headless: false)
  await withBrowser(async (page: Page, context: BrowserContext) => {
    // 간접 접근: 네이버 경유
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
    await randomDelay(1000, 2000);
    await page.goto(COUPANG_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      referer: "https://www.naver.com/",
    });

    let loggedIn = false;

    if (credentials) {
      console.log(chalk.gray("   저장된 계정 정보로 자동 로그인 시도..."));
      loggedIn = await autoLogin(page, credentials);
      if (!loggedIn) {
        console.log(chalk.yellow("   자동 로그인 실패. 브라우저에서 직접 로그인해주세요."));
      }
    }

    if (!loggedIn) {
      loggedIn = await waitForManualLogin(page);
    }

    if (loggedIn) {
      await saveSession(context);
      console.log(chalk.green("\n✅ 로그인 성공! 세션이 저장되었습니다."));
      console.log(chalk.gray("   다음부터는 자동으로 로그인됩니다.\n"));
    } else {
      console.log(chalk.red("\n❌ 로그인 시간이 초과되었습니다. 다시 시도해주세요.\n"));
    }
  }, false);
}

export async function checkLoginStatus(): Promise<boolean> {
  const spinner = ora("로그인 상태 확인 중...").start();

  try {
    const result = await withBrowser(async (page: Page) => {
      await page.goto(COUPANG_HOME_URL, { waitUntil: "domcontentloaded" });

      // 로그인된 상태에서는 "마이쿠팡" 또는 사용자 이름이 표시됨
      const loginLink = await page.$('a[href*="login.coupang.com"]');
      const myLink = await page.$('a[href*="mc/main"]');

      return myLink !== null && loginLink === null;
    }, false);

    if (result) {
      spinner.succeed("로그인 상태: 로그인됨");
    } else {
      spinner.fail("로그인 상태: 로그인 필요");
    }
    return result;
  } catch {
    spinner.fail("로그인 상태 확인 실패");
    return false;
  }
}
