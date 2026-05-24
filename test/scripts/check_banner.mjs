import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium-browser', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
await page.goto('http://14.103.11.193:8088/login.php?logout=true', { waitUntil: 'domcontentloaded' });
await page.fill('input[name=username]', 'muyaowu713001@gmail.com');
await page.fill('input[name=password]', 'Cholesteric2012#');
await Promise.all([page.waitForNavigation({timeout:30000}).catch(()=>null), page.click('input[type=submit]')]);
await page.waitForTimeout(2500);
await page.evaluate(() => { for(const a of document.querySelectorAll('a')) if(/AI Comic|AI漫/.test(a.textContent||'')){a.click();return;} });
await page.waitForTimeout(3500);
const drawer = page.frames().find(f=>/ai_pages_index/.test(f.url()));
await drawer.waitForSelector('a[href*="project=16"]', {timeout:15000});
await drawer.evaluate(()=>document.querySelector('a[href*="project=16"]')?.click());
await page.waitForTimeout(5000);
const proto = page.frames().find(f=>/ai_series_prototype/.test(f.url()));
await proto.waitForLoadState('domcontentloaded').catch(()=>null);
await page.waitForTimeout(2000);
// 切到数字资产
await proto.evaluate(()=>{ for(const el of document.querySelectorAll('[data-screen]')) if(el.dataset.screen==='assets'){el.click();return;} });
await page.waitForTimeout(3500);
const banner = await proto.evaluate(()=> {
    const b = document.getElementById('director-merge-banner');
    return { exists: !!b, html_len: b?.innerHTML?.length || 0, text: (b?.textContent || '').substring(0,200) };
});
console.log(JSON.stringify(banner, null, 2));
await page.screenshot({ path: '/tmp/banner_check.png', fullPage: false });
console.log('screenshot: /tmp/banner_check.png');
await browser.close();
