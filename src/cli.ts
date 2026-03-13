#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { login, checkLoginStatus } from "./login.js";
import { search, searchAndAddToCart, searchAndOrder } from "./search.js";
import { orderByUrl, orderFromSearch } from "./order.js";
import { viewCart } from "./cart.js";
import { clearSession } from "./browser.js";

const program = new Command();

program
  .name("cpcli")
  .description("cpcli - Playwright 기반 쿠팡 쇼핑 자동화 CLI")
  .version("1.0.0");

// 로그인
program
  .command("login")
  .description("쿠팡에 로그인합니다 (브라우저 UI)")
  .action(async () => {
    try {
      await login();
    } catch (error) {
      console.error(chalk.red("로그인 중 오류가 발생했습니다:"), error);
      process.exit(1);
    }
  });

// 로그인 상태 확인
program
  .command("status")
  .description("현재 로그인 상태를 확인합니다")
  .action(async () => {
    try {
      await checkLoginStatus();
    } catch (error) {
      console.error(chalk.red("상태 확인 중 오류:"), error);
      process.exit(1);
    }
  });

// 로그아웃
program
  .command("logout")
  .description("저장된 세션을 삭제합니다")
  .action(async () => {
    await clearSession();
    console.log(chalk.green("세션이 삭제되었습니다.\n"));
  });

// 상품 검색
program
  .command("search <query>")
  .description("쿠팡에서 상품을 검색합니다")
  .option("-o, --order", "검색 후 바로 주문 프로세스로 진행")
  .action(async (query: string, options: { order?: boolean }) => {
    try {
      const selected = await search(query);

      if (selected && options.order) {
        const fullUrl = selected.url.startsWith("http")
          ? selected.url
          : `https://www.coupang.com${selected.url}`;
        await orderFromSearch(fullUrl);
      } else if (selected) {
        const fullUrl = selected.url.startsWith("http")
          ? selected.url
          : `https://www.coupang.com${selected.url}`;
        console.log(chalk.gray(`\n상품 URL: ${fullUrl}`));
        console.log(
          chalk.gray(
            `주문하려면: coupang order "${fullUrl}"\n`,
          ),
        );
      }
    } catch (error) {
      console.error(chalk.red("검색 중 오류:"), error);
      process.exit(1);
    }
  });

// URL로 직접 주문
program
  .command("order <url>")
  .description("상품 URL로 직접 주문합니다")
  .action(async (url: string) => {
    try {
      await orderByUrl(url);
    } catch (error) {
      console.error(chalk.red("주문 중 오류:"), error);
      process.exit(1);
    }
  });

// 검색 후 장바구니 담기 (비인터랙티브)
program
  .command("cart-add <query>")
  .description("상품을 검색하고 장바구니에 담습니다 (비인터랙티브)")
  .option("-n, --pick <number>", "선택할 상품 번호 (기본: 1)", "1")
  .action(async (query: string, options: { pick: string }) => {
    try {
      const pickIndex = parseInt(options.pick, 10) || 1;
      const success = await searchAndAddToCart(query, pickIndex);
      if (!success) {
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("장바구니 담기 중 오류:"), error);
      process.exit(1);
    }
  });

// 검색 후 바로 주문 (비인터랙티브)
program
  .command("order-now <query>")
  .description("상품을 검색하고 바로 주문합니다 (비인터랙티브)")
  .option("-n, --pick <number>", "선택할 상품 번호 (기본: 1)", "1")
  .option("-p, --payment <method>", "결제 수단: coupay 또는 card (기본: coupay)", "coupay")
  .action(async (query: string, options: { pick: string; payment: string }) => {
    try {
      const pickIndex = parseInt(options.pick, 10) || 1;
      const payment = options.payment === "card" ? "card" as const : "coupay" as const;
      const success = await searchAndOrder(query, pickIndex, payment);
      if (!success) {
        console.error(chalk.red("주문에 실패했습니다. 스크린샷을 확인해주세요."));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red("주문 중 오류:"), error);
      process.exit(1);
    }
  });

// 장바구니
program
  .command("cart")
  .description("장바구니를 조회하고 관리합니다")
  .action(async () => {
    try {
      await viewCart();
    } catch (error) {
      console.error(chalk.red("장바구니 조회 중 오류:"), error);
      process.exit(1);
    }
  });

program.parse();
