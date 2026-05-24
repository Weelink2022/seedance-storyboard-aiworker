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
await page.waitForTimeout(2500);
// 打开 OCF modal
await proto.evaluate(() => document.querySelector('#one-click-make-btn')?.click());
await page.waitForTimeout(2500);
// 看 OCF modal 现在内容
const r = await proto.evaluate(() => {
    const modal = document.getElementById('ocf-modal');
    if (!modal) return { exists: false };
    const banner = document.getElementById('ocf-merge-banner');
    return {
        modal_visible: modal.offsetParent !== null,
        summary_text: (document.querySelector('#ocf-modal .ocf-summary')?.textContent || '').substring(0,300),
        merge_banner_html_len: banner?.innerHTML?.length || 0,
        merge_banner_text: (banner?.textContent || '').substring(0,300),
    };
});
console.log(JSON.stringify(r, null, 2));
await page.screenshot({ path: '/tmp/ocf_merge_check.png', fullPage: false });
await browser.close();
