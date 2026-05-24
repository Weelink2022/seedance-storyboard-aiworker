// 共用工具 — 登录、frame 定位、截图、时间戳
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const RS_HOST = 'http://14.103.11.193:8088';
export const TEST_ROOT = '/root/Seedance 2.0 分镜师团队/test';
export const SHOTS_DIR = path.join(TEST_ROOT, 'screenshots');
export const SNAPS_DIR = path.join(TEST_ROOT, 'snapshots');

export const ACCOUNT_MUYAOWU = {
  username: 'muyaowu713001@gmail.com',
  password: 'Cholesteric2012#',
  company_ref: 4,
  user_ref: 6,
};
export const ACCOUNT_BAILE = {
  username: '664534335@qq.com',
  password: '6122024oK#',
  company_ref: 2,
  user_ref: 15,
};

export const TESTTEST5 = { project_ref: 16, title: 'testtest5' };

// 测试常量(避免污染真数据)
export const TEST_EP_NUM = 99;
export const TEST_EP_TITLE = 'E2E测试集';
export const TEST_SCENE_NAME = 'E2E测试场1';

export function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export async function launchBrowser({ headless = true } = {}) {
  // 服务器无 X server,默认 headless;通过截图观察
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.mkdirSync(SNAPS_DIR, { recursive: true });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
    deviceScaleFactor: 1,
  });
  return { browser, ctx };
}

export async function login(page, account = ACCOUNT_MUYAOWU) {
  await page.goto(`${RS_HOST}/login.php?logout=true`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name=username]', account.username);
  await page.fill('input[name=password]', account.password);
  await Promise.all([
    page.waitForNavigation({ timeout: 30000 }).catch(() => null),
    page.click('input[type=submit], button[type=submit]'),
  ]);
  await page.waitForTimeout(2000);
  if (!/home\.php/.test(page.url())) {
    throw new Error(`login failed: account=${account.username} url=${page.url()}`);
  }
}

// 走漫控台进入路径 → 落到工作台 iframe
export async function enterWorkbench(page, projectRef) {
  // 顶栏 AI Comic → drawer
  await page.evaluate(() => {
    for (const a of document.querySelectorAll('a')) {
      if (/AI Comic|AI漫/.test(a.textContent || '')) { a.click(); return; }
    }
  });
  await page.waitForTimeout(3500);
  const drawer = page.frames().find(f => /ai_pages_index/.test(f.url()));
  if (!drawer) throw new Error('drawer iframe 未找到');
  await drawer.waitForSelector(`a[href*="ai_series_prototype"][href*="project=${projectRef}"]`, { timeout: 15000 });
  await drawer.evaluate((pid) => {
    document.querySelector(`a[href*="ai_series_prototype"][href*="project=${pid}"]`)?.click();
  }, projectRef);
  await page.waitForTimeout(5000);
  const proto = page.frames().find(f => /ai_series_prototype/.test(f.url()));
  if (!proto) throw new Error('工作台 iframe 未找到');
  await proto.waitForLoadState('domcontentloaded').catch(() => null);
  await page.waitForTimeout(2500);
  return proto;
}

// 走剧集侧入口
export async function enterSeriesBrowse(page) {
  await page.evaluate(() => {
    for (const a of document.querySelectorAll('a')) {
      if (/^\s*(剧集|Series)\s*$/.test(a.textContent?.trim() || '')) { a.click(); return; }
      if ((a.getAttribute('href') || '').includes('series_browse=1')) { a.click(); return; }
    }
  });
  await page.waitForTimeout(2500);
}

export async function snap(page, name) {
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`📸 ${file}`);
  return file;
}

export function writeSnapshot(name, obj) {
  const file = path.join(SNAPS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  console.log(`💾 ${file}`);
  return file;
}

export function loadSnapshot(name) {
  const file = path.join(SNAPS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function logPhase(n, name) {
  const line = '═'.repeat(60);
  console.log(`\n${line}\n  Phase ${n} — ${name}\n${line}`);
}
