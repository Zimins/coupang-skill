import type { Page, BrowserContext } from "playwright";
import { withBrowser, randomDelay, takeScreenshot, naturalScroll, saveSession, getSessionDir } from "./browser.js";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import path from "node:path";
import fs from "node:fs";

export interface SearchResult {
  name: string;
  price: string;
  url: string;
  rating?: string;
  rocketDelivery: boolean;
}

/** 쿠팡 페이지에서 로그인 여부 확인 */
async function checkLoginOnPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // Access Denied 페이지면 로그인 판단 불가
    if (document.body.innerText.includes("Access Denied")) return false;
    const loginLink = document.querySelector('a[href*="login.coupang.com"]');
    // 로그인 링크가 보이면 미로그인 상태
    return !loginLink;
  });
}

/** 자동 로그인 시도 */
async function tryAutoLogin(page: Page, context: BrowserContext): Promise<boolean> {
  const credPath = path.join(getSessionDir(), "credentials.json");
  if (!fs.existsSync(credPath)) return false;

  let creds: { email: string; password: string };
  try {
    creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    if (!creds.email || !creds.password) return false;
  } catch {
    return false;
  }

  console.log(chalk.gray("   로그인이 필요합니다. 자동 로그인 시도..."));

  // 네이버 → "쿠팡" 검색 → 쿠팡 링크 클릭 → 로그인 페이지 이동
  await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
  await randomDelay(800, 1500);
  const loginSearchInput = await page.$('input#query, input[name="query"]');
  if (loginSearchInput) {
    await loginSearchInput.click();
    await randomDelay(300, 600);
    await loginSearchInput.fill("쿠팡");
    await randomDelay(300, 500);
    await page.keyboard.press("Enter");
    await randomDelay(2000, 3000);

    // 네이버 검색 결과에서 쿠팡 링크 클릭
    const coupangLink = await page.$('a[href*="coupang.com"]');
    if (coupangLink) {
      await coupangLink.click();
      await randomDelay(2000, 3000);
    }
  }
  await page.goto("https://login.coupang.com/login/login.pang", {
    waitUntil: "domcontentloaded",
    referer: "https://www.coupang.com/",
  });
  await randomDelay(1000, 2000);
  await takeScreenshot(page, "login-page");

  // 이미 로그인 상태로 리다이렉트된 경우
  if (!page.url().includes("login.coupang.com")) {
    console.log(chalk.green("   ✅ 이미 로그인됨 (리다이렉트)"));
    return true;
  }

  try {
    await page.fill('input[name="email"], input#login-email-input', creds.email);
    await randomDelay(500, 1000);
    await page.fill('input[name="password"], input#login-password-input', creds.password);
    await randomDelay(500, 1000);
    await page.click('button[type="submit"], .login__button');

    await page.waitForURL((url) => !url.toString().includes("login.coupang.com"), {
      timeout: 30_000,
    });

    await saveSession(context);
    console.log(chalk.green("   ✅ 로그인 성공!"));
    return true;
  } catch (e) {
    await takeScreenshot(page, "login-failed");
    console.log(chalk.yellow(`   ⚠ 자동 로그인 실패: ${page.url()}`));
    return false;
  }
}

async function navigateToCoupangViaSearch(page: Page): Promise<Page> {
  // 1. 네이버 이동
  console.log(chalk.gray("   네이버로 이동..."));
  await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded" });
  await randomDelay(1000, 2000);

  // 2. 네이버에서 "쿠팡" 검색 (브라우저 히스토리/referrer 생성 목적)
  const naverSearchInput = await page.$('input#query, input[name="query"]');
  if (naverSearchInput) {
    await naverSearchInput.click();
    await randomDelay(300, 600);
    await naverSearchInput.fill("쿠팡");
    await randomDelay(300, 500);
    await page.keyboard.press("Enter");
    await randomDelay(2000, 3000);
    await takeScreenshot(page, "01-naver-search-coupang");
    console.log(chalk.gray("   네이버 검색 완료, 쿠팡으로 이동..."));
  }

  // 3. 네이버 검색 결과에서 쿠팡 링크 클릭
  const coupangLink = await page.$('a[href="https://www.coupang.com/"]');
  if (coupangLink) {
    console.log(chalk.gray("   네이버에서 쿠팡 링크 클릭..."));
    const [newPage] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 10_000 }).catch(() => null),
      coupangLink.click(),
    ]);
    if (newPage) {
      await newPage.waitForLoadState("domcontentloaded");
      page = newPage;
    }
  } else {
    // fallback: 직접 이동
    console.log(chalk.gray("   쿠팡 링크 미발견, 직접 이동..."));
    await page.goto("https://www.coupang.com/", { waitUntil: "domcontentloaded" });
  }

  await randomDelay(2000, 3000);
  await takeScreenshot(page, "02-coupang-home");
  console.log(chalk.gray(`   쿠팡 진입: ${page.url()}`));
  return page;
}

async function searchProducts(initialPage: Page, query: string, context: BrowserContext): Promise<{ results: SearchResult[]; page: Page }> {
  // 1. 네이버 → "쿠팡" 검색 → 쿠팡 링크 클릭 → 쿠팡 이동
  let page = await navigateToCoupangViaSearch(initialPage);

  // 2. 로그인 여부 확인 → 미로그인이면 자동 로그인
  const isLoggedIn = await checkLoginOnPage(page);
  if (!isLoggedIn) {
    const loginOk = await tryAutoLogin(page, context);
    if (!loginOk) {
      console.log(chalk.red("   로그인 없이 검색을 계속합니다 (장바구니/주문 불가)."));
    }
    // 로그인 후 쿠팡 홈으로 돌아가기
    if (loginOk) {
      await page.goto("https://www.coupang.com/", { waitUntil: "domcontentloaded" });
      await randomDelay(1000, 2000);
    }
  } else {
    console.log(chalk.green("   ✅ 로그인 확인됨"));
  }

  // 3. 쿠팡 홈에서 자연스럽게 둘러보기 (봇 감지 회피)
  if (!page.url().includes("coupang.com")) {
    await page.goto("https://www.coupang.com/", { waitUntil: "domcontentloaded" });
    await randomDelay(2000, 3000);
  }
  console.log(chalk.gray("   쿠팡 홈 둘러보는 중..."));
  await naturalScroll(page, 2);
  await page.keyboard.press("Home");
  await randomDelay(1500, 2500);

  // 4. 쿠팡 검색창에서 상품 검색 (키보드 입력으로 자연스럽게)
  console.log(chalk.gray(`   쿠팡에서 "${query}" 검색...`));
  const searchInput = await page.$('input.search-input, input[name="q"], input#headerSearchKeyword');
  if (searchInput) {
    await searchInput.click();
    await randomDelay(500, 1000);
    // 자연스러운 타이핑 (랜덤 딜레이)
    for (const char of query) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 100) + 50 });
    }
    await randomDelay(800, 1500);
    // 검색 버튼 클릭 (Enter 대신 버튼 클릭이 더 자연스러움)
    const searchBtn = await page.$('button.search-btn, button[type="submit"], .search-submit, button.HeaderSearchForm__button');
    if (searchBtn) {
      await searchBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }
  } else {
    // fallback: URL로 직접 검색
    await page.goto(`https://www.coupang.com/np/search?component=&q=${encodeURIComponent(query)}&channel=user`, {
      waitUntil: "domcontentloaded",
      referer: "https://www.coupang.com/",
    });
  }

  // 검색 결과 로드 대기
  await randomDelay(3000, 4000);

  // 자연 스크롤로 DOM 완전 로드 (블로그 권장: PageDown + End 키)
  console.log(chalk.gray("   검색 결과 로드 중 (스크롤)..."));
  await naturalScroll(page, 3);
  // 다시 맨 위로 스크롤
  await page.keyboard.press("Home");
  await randomDelay(1000, 2000);

  // 4. 검색 결과 페이지 검증
  await takeScreenshot(page, "04-search-result");
  console.log(chalk.gray(`   검색 URL: ${page.url()}`));

  // Access Denied 체크 → 재시도
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  if (bodyText.includes("Access Denied") || bodyText.includes("접근이 거부")) {
    console.log(chalk.yellow("   Access Denied 감지. 뒤로가서 재시도..."));
    await page.goBack();
    await randomDelay(3000, 5000);
    await naturalScroll(page, 2);
    await page.keyboard.press("Home");
    await randomDelay(2000, 3000);

    // 재시도: 검색창에서 다시 검색
    const retryInput = await page.$('input.search-input, input[name="q"], input#headerSearchKeyword');
    if (retryInput) {
      await retryInput.click();
      await randomDelay(500, 1000);
      for (const char of query) {
        await page.keyboard.type(char, { delay: Math.floor(Math.random() * 120) + 60 });
      }
      await randomDelay(1000, 2000);
      const retryBtn = await page.$('button.search-btn, button[type="submit"], .search-submit, button.HeaderSearchForm__button');
      if (retryBtn) {
        await retryBtn.click();
      } else {
        await page.keyboard.press("Enter");
      }
      await randomDelay(3000, 5000);
      await naturalScroll(page, 3);
      await page.keyboard.press("Home");
      await randomDelay(1000, 2000);
      await takeScreenshot(page, "04-search-result-retry");

      const retryText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      if (retryText.includes("Access Denied") || retryText.includes("접근이 거부")) {
        console.log(chalk.red("   재시도에도 Access Denied. 스크린샷을 확인하세요."));
        return { results: [], page };
      }
    } else {
      console.log(chalk.red("   Access Denied 후 검색창을 찾을 수 없습니다."));
      return { results: [], page };
    }
  }

  // 검색 결과 파싱 (여러 셀렉터 시도)
  const results = await page.evaluate(() => {
    // ProductUnit 기반 (현재 쿠팡 구조)
    let items = document.querySelectorAll('li[class*="ProductUnit"]');
    // fallback: search-product 기반
    if (items.length === 0) {
      items = document.querySelectorAll('li.search-product, li[class*="search-product"]');
    }
    // fallback: baby-product-wrap 기반
    if (items.length === 0) {
      items = document.querySelectorAll('li.baby-product-wrap, li[class*="baby-product"]');
    }
    const parsed: Array<{
      name: string;
      price: string;
      url: string;
      rating?: string;
      rocketDelivery: boolean;
    }> = [];

    items.forEach((item, i) => {
      if (i >= 20) return;

      // 상품명 (여러 셀렉터 시도)
      const nameEl = item.querySelector(
        '[class*="productName"], .name, .descriptions .name, dt.name, .title'
      );
      // 링크 (여러 패턴)
      const linkEl = item.querySelector(
        "a[href*='/vp/products/'], a[href*='/vp/'], a.baby-product-link"
      );
      // 로켓배송 배지
      const rocketEl = item.querySelector(
        '[data-badge-id="ROCKET"], [data-badge-id="ROCKET_MERCHANT"], .badge.rocket'
      );

      const name = nameEl?.textContent?.trim();
      // 링크가 없으면 item 자체나 상위 a 태그에서 찾기
      let url = linkEl?.getAttribute("href");
      if (!url) {
        const parentLink = item.querySelector("a[href]");
        const href = parentLink?.getAttribute("href") ?? "";
        if (href.includes("coupang.com") || href.startsWith("/vp/")) {
          url = href;
        }
      }
      if (!name || !url) return;

      // 가격 추출 (여러 셀렉터)
      const priceArea = item.querySelector(
        '[class*="priceArea"], .price-area, .price, .price-value, em.sale'
      );
      let price = "(가격 정보 없음)";
      if (priceArea) {
        const priceSpans = priceArea.querySelectorAll("span, em, strong");
        for (const span of Array.from(priceSpans)) {
          const text = span.textContent?.trim() ?? "";
          if (text.match(/[\d,]+원?/) && text.length < 20) {
            price = text.includes("원") ? text : text + "원";
            break;
          }
        }
        // fallback: priceArea 자체 텍스트
        if (price === "(가격 정보 없음)") {
          const areaText = priceArea.textContent?.trim() ?? "";
          const priceMatch = areaText.match(/([\d,]+)원/);
          if (priceMatch) price = priceMatch[0];
        }
      }

      parsed.push({
        name,
        price,
        url,
        rocketDelivery: rocketEl !== null,
      });
    });

    return parsed;
  });

  return { results, page };
}

function displayResults(results: SearchResult[]): void {
  if (results.length === 0) {
    console.log(chalk.yellow("\n검색 결과가 없습니다.\n"));
    return;
  }

  console.log(chalk.blue(`\n검색 결과 (${results.length}개):\n`));

  results.forEach((item, index) => {
    const rocket = item.rocketDelivery ? chalk.magenta(" 🚀로켓배송") : "";
    const rating = item.rating ? chalk.yellow(` ★${item.rating}`) : "";
    console.log(
      `  ${chalk.white(`${index + 1}.`)} ${chalk.bold(item.name)}`,
    );
    const displayPrice = item.price.endsWith("원") ? item.price : item.price + "원";
    console.log(
      `     ${chalk.green(displayPrice)}${rocket}${rating}`,
    );
    console.log();
  });
}

export async function search(query: string): Promise<SearchResult | undefined> {
  const spinner = ora(`"${query}" 검색 중...`).start();

  const { results } = await withBrowser(async (page, context) => {
    spinner.stop(); // 스크린샷 로그 보이게
    return searchProducts(page, query, context);
  }, false);

  displayResults(results);

  if (results.length === 0) {
    console.log(chalk.gray("   스크린샷: ~/.coupang-session/screenshots/ 에서 확인 가능\n"));
    return undefined;
  }

  const { selectedIndex } = await inquirer.prompt<{ selectedIndex: number }>([
    {
      type: "number",
      name: "selectedIndex",
      message: "상품 번호를 선택하세요 (0: 취소):",
      default: 0,
      validate: (val: number) => {
        if (val >= 0 && val <= results.length) return true;
        return `1~${results.length} 사이의 번호를 입력하세요 (0: 취소)`;
      },
    },
  ]);

  if (selectedIndex === 0) {
    console.log(chalk.gray("취소되었습니다.\n"));
    return undefined;
  }

  return results[selectedIndex - 1];
}

/**
 * 검색 → 첫 번째 상품 선택 → 장바구니 담기까지 한 세션에서 처리
 * CLI 비인터랙티브 모드용
 */
export async function searchAndAddToCart(query: string, pickIndex = 1): Promise<boolean> {
  const spinner = ora(`"${query}" 검색 후 장바구니 담기...`).start();

  const result = await withBrowser(async (page, context) => {
    spinner.stop();
    const searchResult = await searchProducts(page, query, context);
    let currentPage = searchResult.page;
    displayResults(searchResult.results);

    if (searchResult.results.length === 0) {
      console.log(chalk.red("   검색 결과가 없습니다."));
      return false;
    }

    const selected = searchResult.results[Math.min(pickIndex - 1, searchResult.results.length - 1)];
    console.log(chalk.blue(`\n   → ${pickIndex}번 상품 선택: ${selected.name}`));

    // 같은 세션에서 상품 페이지로 이동 (currentPage = 쿠팡 탭)
    const fullUrl = selected.url.startsWith("http")
      ? selected.url
      : `https://www.coupang.com${selected.url}`;

    await currentPage.goto(fullUrl, { waitUntil: "domcontentloaded" });
    await randomDelay(2000, 3000);
    await takeScreenshot(currentPage, "05-product-page");

    // 장바구니 담기 버튼 클릭 (currentPage에서 찾기)
    const cartBtn = await currentPage.$(
      'button.prod-btn-cart, button[class*="cart"], .prod-quantity-cart-button button, ' +
      'button:has-text("장바구니"), [class*="addToCart"] button',
    );

    if (!cartBtn) {
      // 대체: 장바구니 텍스트가 포함된 버튼 찾기
      const altBtn = await currentPage.$('button >> text=장바구니');
      if (altBtn) {
        await altBtn.click();
      } else {
        console.log(chalk.red("   장바구니 버튼을 찾을 수 없습니다."));
        await takeScreenshot(currentPage, "05-no-cart-btn");
        return false;
      }
    } else {
      await cartBtn.click();
    }

    await randomDelay(2000, 3000);
    await takeScreenshot(currentPage, "06-after-cart");
    await saveSession(context);

    console.log(chalk.green("\n   ✅ 장바구니에 담았습니다!"));
    return true;
  }, false);

  return result;
}

/** credentials.json에서 결제 PIN 로드 */
function loadPaymentPin(): string | null {
  const credPath = path.join(getSessionDir(), "credentials.json");
  if (!fs.existsSync(credPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    return data.paymentPin ?? null;
  } catch {
    return null;
  }
}

/**
 * PIN 키패드 처리: 스크린샷 캡쳐 → 이미지 인식 기반
 * 1단계: 각 키 스크린샷 저장 + keypad-mapping.json 없으면 false
 * 2단계: keypad-mapping.json 있으면 매핑대로 클릭
 */
async function handlePinKeypad(page: Page, pin: string): Promise<boolean> {
  console.log(chalk.gray("   비밀번호 키패드 입력 중..."));
  await randomDelay(1000, 2000);

  // 키패드가 있는 프레임 찾기 (모든 프레임 순회)
  const allFrames = page.frames();
  let targetFrame: typeof allFrames[0] | null = null;

  for (const frame of allFrames) {
    try {
      const padKeyCount = await frame.locator("a.pad-key").count();
      if (padKeyCount > 0) {
        targetFrame = frame;
        console.log(chalk.gray(`   키패드 프레임 발견 (pad-key ${padKeyCount}개): ${frame.url().slice(0, 80)}`));
        break;
      }
    } catch {
      continue;
    }
  }

  // pad-key로 못 찾으면 "비밀번호" 텍스트로 찾기
  if (!targetFrame) {
    for (const frame of allFrames) {
      try {
        const hasPinText = await frame.locator('text=비밀번호').count();
        if (hasPinText > 0) {
          targetFrame = frame;
          console.log(chalk.gray(`   키패드 프레임 (비밀번호 텍스트): ${frame.url().slice(0, 80)}`));
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!targetFrame) {
    // 프레임 정보 덤프
    console.log(chalk.red("   키패드 프레임을 찾을 수 없습니다."));
    console.log(chalk.gray(`   전체 프레임 수: ${allFrames.length}`));
    for (const f of allFrames) {
      console.log(chalk.gray(`     - ${f.url().slice(0, 100)}`));
    }
    await takeScreenshot(page, "pin-no-frame");
    return false;
  }

  // alert3 오버레이 닫기
  try {
    const alertClose = targetFrame.locator('.alert3 button, .alert3__close, .alert3 .btn');
    if (await alertClose.count() > 0) {
      await alertClose.first().click();
      await randomDelay(500, 1000);
    }
  } catch { /* ignore */ }

  const padKeys = targetFrame.locator("a.pad-key");
  const keyCount = await padKeys.count();
  console.log(chalk.gray(`   키패드 키 수: ${keyCount}`));

  if (keyCount === 0) {
    console.log(chalk.red("   키패드 키를 찾을 수 없습니다."));
    await takeScreenshot(page, "pin-no-keys");
    return false;
  }

  // 각 키 스크린샷 저장 (이미지 기반 인식 필요 — DOM 텍스트는 실제 표시와 다름)
  const screenshotDir = path.join(getSessionDir(), "screenshots");
  for (let i = 0; i < keyCount; i++) {
    try {
      const buf = await padKeys.nth(i).screenshot();
      fs.writeFileSync(path.join(screenshotDir, `pad-key-${i}.png`), buf);
    } catch { /* ignore */ }
  }

  const mappingPath = path.join(getSessionDir(), "keypad-mapping.json");
  if (fs.existsSync(mappingPath)) fs.unlinkSync(mappingPath);
  const readyPath = path.join(getSessionDir(), "keypad-ready");
  fs.writeFileSync(readyPath, new Date().toISOString());
  console.log(chalk.yellow("   ⏳ 키패드 스크린샷 저장 완료. keypad-mapping.json 대기 중..."));
  console.log(chalk.gray(`   스크린샷: ${screenshotDir}/pad-key-*.png`));

  // 매핑 파일이 생길 때까지 폴링 (최대 180초)
  let mapping: Record<string, string> | null = null;
  for (let wait = 0; wait < 180; wait++) {
    await new Promise(r => setTimeout(r, 1000));
    if (fs.existsSync(mappingPath)) {
      try {
        mapping = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
        if (mapping && Object.keys(mapping).length >= 10) break;
        mapping = null;
      } catch { /* still waiting */ }
    }
  }
  if (fs.existsSync(readyPath)) fs.unlinkSync(readyPath);

  if (!mapping) {
    console.log(chalk.red("   ⏰ 매핑 대기 시간 초과 (180초)"));
    return false;
  }

  console.log(chalk.green(`   ✅ 매핑 파일 수신! (${Object.keys(mapping).length}개)`));

  // 역매핑: 숫자 → 키인덱스
  const digitToKey: Record<string, number> = {};
  for (const [keyIdx, digit] of Object.entries(mapping)) {
    digitToKey[digit] = parseInt(keyIdx, 10);
  }

  console.log(chalk.green(`   ✅ 키패드 매핑: ${Object.entries(mapping).map(([k, v]) => `[${k}]=${v}`).join(" ")}`));

  // PIN 입력
  for (const digit of pin) {
    const keyIdx = digitToKey[digit];
    if (keyIdx === undefined) {
      console.log(chalk.red(`   키패드에서 숫자 ${digit}를 찾을 수 없습니다.`));
      return false;
    }
    await padKeys.nth(keyIdx).click({ force: true });
    await randomDelay(200, 400);
  }

  console.log(chalk.green("   ✅ PIN 입력 완료"));
  await randomDelay(2000, 3000);
  return true;
}

/**
 * 검색 → 상품 선택 → 바로구매 → 결제까지 한 세션에서 처리
 * paymentMethod: "coupay" | "card"
 */
export async function searchAndOrder(
  query: string,
  pickIndex = 1,
  paymentMethod: "coupay" | "card" = "coupay",
): Promise<boolean> {
  const spinner = ora(`"${query}" 검색 후 주문 진행...`).start();

  const result = await withBrowser(async (initialPage, context) => {
    spinner.stop();
    const searchResult = await searchProducts(initialPage, query, context);
    let page = searchResult.page;
    const results = searchResult.results;
    displayResults(results);

    if (results.length === 0) {
      console.log(chalk.red("   검색 결과가 없습니다."));
      return false;
    }

    const selected = results[Math.min(pickIndex - 1, results.length - 1)];
    console.log(chalk.blue(`\n   → ${pickIndex}번 상품 선택: ${selected.name}`));
    console.log(chalk.blue(`     가격: ${selected.price}`));

    // 검색 결과에서 상품 링크 직접 클릭 (Access Denied 방지)
    console.log(chalk.gray("   상품 페이지로 이동..."));
    const productLinks = await page.$$("a[href*='/vp/products/']");
    let clicked = false;
    for (const link of productLinks) {
      const href = await link.getAttribute("href");
      if (href === selected.url) {
        // 새 탭이 열릴 수 있으므로 popup 이벤트 처리
        const [newPage] = await Promise.all([
          page.context().waitForEvent("page", { timeout: 10_000 }).catch(() => null),
          link.click(),
        ]);
        if (newPage) {
          await newPage.waitForLoadState("domcontentloaded");
          page = newPage;
        }
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      // fallback: 첫 번째 검색 결과 링크 클릭
      console.log(chalk.gray("   정확한 링크 미발견, 검색결과에서 직접 클릭..."));
      const firstProduct = productLinks[Math.min(pickIndex - 1, productLinks.length - 1)];
      if (firstProduct) {
        const [newPage] = await Promise.all([
          page.context().waitForEvent("page", { timeout: 10_000 }).catch(() => null),
          firstProduct.click(),
        ]);
        if (newPage) {
          await newPage.waitForLoadState("domcontentloaded");
          page = newPage;
        }
        clicked = true;
      }
    }

    if (!clicked) {
      console.log(chalk.red("   상품 링크를 찾을 수 없습니다."));
      return false;
    }

    await randomDelay(3000, 4000);
    await takeScreenshot(page, "order-01-product");
    console.log(chalk.gray(`   상품 URL: ${page.url()}`));

    // Access Denied 체크
    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 200));
    if (pageText.includes("Access Denied")) {
      console.log(chalk.red("   Access Denied! 다른 상품을 시도합니다."));
      return false;
    }

    // 바로구매 클릭
    console.log(chalk.gray("   바로구매 클릭..."));
    const buyBtn = await page.$('button:has-text("바로구매"), button.prod-buy-btn');
    if (!buyBtn) {
      console.log(chalk.red("   바로구매 버튼을 찾을 수 없습니다."));
      await takeScreenshot(page, "order-01-no-buy-btn");
      return false;
    }

    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      buyBtn.click(),
    ]);
    await randomDelay(3000, 4000);
    await takeScreenshot(page, "order-02-checkout");
    console.log(chalk.gray(`   주문서 URL: ${page.url()}`));

    // 주문서 페이지 확인
    if (!page.url().includes("checkout")) {
      console.log(chalk.red("   주문서 페이지로 이동하지 못했습니다."));
      return false;
    }

    // 주문 정보 출력
    const orderInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      const addressMatch = body.match(/배송지[\s\S]*?([\w가-힣]+ [\w가-힣]+ [\w가-힣]+[\s\S]*?(?:\d{3}-\d{3,4}-\d{4}))/);
      const priceMatch = body.match(/총 결제 금액\s*([\d,]+원)/);
      return {
        address: addressMatch?.[1]?.trim()?.slice(0, 150) ?? "(주소 미확인)",
        totalPrice: priceMatch?.[1] ?? "(금액 미확인)",
      };
    });

    console.log(chalk.blue("\n   ========== 주문 요약 =========="));
    console.log(`   배송지: ${orderInfo.address}`);
    console.log(`   총 결제 금액: ${chalk.green.bold(orderInfo.totalPrice)}`);
    console.log(`   결제 수단: ${paymentMethod === "coupay" ? "쿠페이 머니" : "신용/체크카드"}`);
    console.log(chalk.blue("   ================================\n"));

    // 결제 수단 선택
    const payLabel = paymentMethod === "coupay" ? "쿠페이 머니" : "신용/체크카드";
    console.log(chalk.gray(`   ${payLabel} 선택...`));
    const paySelected = await page.evaluate((label: string) => {
      const spans = document.querySelectorAll("span");
      for (const span of Array.from(spans)) {
        if (span.textContent?.trim() === label) {
          let el: HTMLElement | null = span;
          for (let i = 0; i < 10 && el; i++) {
            el = el.parentElement;
            if (el?.className?.includes("twc-flex") && el?.className?.includes("twc-items-center")) {
              const radioSpan = el.querySelector("span.twc-cursor-pointer, span[class*='cursor-pointer']");
              if (radioSpan) {
                (radioSpan as HTMLElement).click();
                return "clicked-radio";
              }
              el.click();
              return "clicked-container";
            }
          }
        }
      }
      return "not-found";
    }, payLabel);
    console.log(chalk.gray(`   ${payLabel} 선택 결과: ${paySelected}`));
    await randomDelay(1000, 2000);
    await takeScreenshot(page, "order-03-payment-selected");

    // 결제하기 버튼 클릭
    console.log(chalk.yellow.bold("   결제하기 버튼 클릭..."));
    const payBtn = await page.$('button:has-text("결제하기"), button:has-text("주문하기")');
    if (!payBtn) {
      console.log(chalk.red("   결제 버튼을 찾을 수 없습니다."));
      await takeScreenshot(page, "order-04-no-pay-btn");
      return false;
    }

    await payBtn.click();
    console.log(chalk.gray("   결제 처리 대기..."));
    await randomDelay(5000, 8000);
    await takeScreenshot(page, "order-04-after-pay-click");

    // 모든 frame에서 상태 체크 (모달이 iframe 안에 있을 수 있음)
    const frames = page.frames();
    console.log(chalk.gray(`   프레임 수: ${frames.length}`));

    let chargeHandled = false;
    for (const frame of frames) {
      try {
        const chargeBtn = frame.locator('text=충전하고 결제하기');
        const count = await chargeBtn.count();
        if (count > 0) {
          console.log(chalk.yellow("   쿠페이 머니 잔액 부족 → 충전 후 결제 진행..."));
          console.log(chalk.gray(`   프레임 URL: ${frame.url()}`));
          await chargeBtn.first().click();
          console.log(chalk.green("   충전하고 결제하기 버튼 클릭!"));
          chargeHandled = true;
          await randomDelay(3000, 5000);
          await takeScreenshot(page, "order-05-after-charge-click");
          break;
        }
      } catch {
        continue;
      }
    }

    if (!chargeHandled) {
      // 메인 페이지에서 직접 JS로 시도
      console.log(chalk.gray("   프레임에서 충전 버튼 미발견, JS 직접 탐색..."));
      const jsClick = await page.evaluate(() => {
        // 전체 DOM 탐색 (shadow DOM 포함)
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const el = node as HTMLElement;
          const text = el.textContent?.trim() ?? "";
          // 정확히 "충전하고 결제하기"만 포함하는 leaf 요소 클릭
          if (text === "충전하고 결제하기" || (text.includes("충전하고 결제하기") && el.children.length <= 2)) {
            el.click();
            return `clicked: ${el.tagName}.${el.className.slice(0, 50)}`;
          }
        }
        // iframe 내부 검색
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of Array.from(iframes)) {
          try {
            const iframeDoc = iframe.contentDocument;
            if (!iframeDoc) continue;
            const btn = iframeDoc.querySelector("button, [role='button']");
            if (btn?.textContent?.includes("충전하고 결제하기")) {
              (btn as HTMLElement).click();
              return `clicked iframe: ${btn.tagName}`;
            }
          } catch {
            // cross-origin iframe
          }
        }
        return null;
      });
      console.log(chalk.gray(`   JS 탐색 결과: ${jsClick}`));
      if (jsClick) {
        chargeHandled = true;
        await randomDelay(3000, 5000);
        await takeScreenshot(page, "order-05-after-charge-click");
      }
    }

    // PIN 키패드 처리 (비밀번호 입력 팝업이 나타나면 - iframe 포함)
    const pin = loadPaymentPin();
    // 최대 3회 PIN 시도 (충전 PIN + 결제 PIN + 추가)
    for (let attempt = 0; attempt < 3; attempt++) {
      await randomDelay(1000, 2000);

      // 모든 프레임에서 PIN 키패드 찾기
      let hasPinKeypad = false;
      for (const frame of page.frames()) {
        try {
          const pinCount = await frame.locator('text=비밀번호').count();
          if (pinCount > 0) {
            hasPinKeypad = true;
            break;
          }
        } catch { continue; }
      }

      if (hasPinKeypad) {
        if (!pin) {
          console.log(chalk.red("   결제 PIN이 필요합니다. credentials.json에 paymentPin을 추가해주세요."));
          return false;
        }
        console.log(chalk.gray(`   비밀번호 키패드 감지 (${attempt + 1}차)...`));
        const pinOk = await handlePinKeypad(page, pin);
        if (!pinOk) {
          console.log(chalk.red("   PIN 입력 실패"));
          return false;
        }
        await randomDelay(3000, 5000);
        await takeScreenshot(page, `order-06-after-pin-${attempt + 1}`);
      } else {
        break;
      }
    }

    // 결제 완료 대기
    console.log(chalk.gray("   결제 완료 대기..."));
    try {
      // URL 변경 감지 또는 완료 텍스트 감지
      await Promise.race([
        page.waitForURL(
          (url) => {
            const u = url.toString();
            return u.includes("orderComplete") || u.includes("success") || u.includes("/done");
          },
          { timeout: 60000 },
        ),
        // 주문 완료 텍스트가 본문에 나타나길 대기 (breadcrumb 제외)
        page.waitForSelector('text=주문이 완료되었습니다, text=주문번호, text=결제가 완료', {
          timeout: 60000,
        }),
      ]);

      await takeScreenshot(page, "order-06-complete");

      // 실제 완료인지 확인 (breadcrumb "주문완료" 오탐 방지)
      const completionCheck = await page.evaluate(() => {
        const body = document.body.innerText;
        return body.includes("주문번호") ||
               body.includes("주문이 완료") ||
               body.includes("결제가 완료") ||
               body.includes("배송 예정");
      });

      if (completionCheck) {
        console.log(chalk.green.bold("\n   🎉 주문이 완료되었습니다!"));

        const orderDetails = await page.evaluate(() => {
          const body = document.body.innerText;
          const orderNumMatch = body.match(/주문번호[:\s]*([\d]+)/);
          return {
            orderNumber: orderNumMatch?.[1] ?? null,
            summary: body.slice(0, 500),
          };
        });

        if (orderDetails.orderNumber) {
          console.log(chalk.green(`   주문번호: ${orderDetails.orderNumber}`));
        }
        console.log(chalk.gray(`   ${orderDetails.summary.slice(0, 200)}`));

        await saveSession(context);
        return true;
      }
    } catch {
      // timeout
    }

    // 최종 상태 확인
    await takeScreenshot(page, "order-06-final-state");
    const finalUrl = page.url();
    console.log(chalk.gray(`   최종 URL: ${finalUrl}`));

    const finalPageText = await page.evaluate(() => document.body.innerText.slice(0, 1000));

    // 에러 모달 확인
    if (finalPageText.includes("잔액이 부족") || finalPageText.includes("충전")) {
      console.log(chalk.red("   쿠페이 머니 잔액 부족. 충전이 필요합니다."));
      return false;
    }

    if (finalPageText.includes("주문번호") || finalPageText.includes("주문이 완료")) {
      console.log(chalk.green.bold("\n   🎉 주문이 완료되었습니다!"));
      await saveSession(context);
      return true;
    }

    console.log(chalk.yellow("   결제 결과를 확인할 수 없습니다."));
    console.log(chalk.gray(`   페이지 내용: ${finalPageText.slice(0, 300)}`));
    return false;
  }, false);

  return result;
}
