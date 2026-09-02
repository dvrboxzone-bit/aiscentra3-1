import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 620 } });
await page.goto('http://localhost:3800/');
await page.waitForTimeout(300);
await page.click('.assistant-tab');
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const scrollEl = document.querySelector('.assistant-panel .overflow-y-auto');
  const scrollElRect = scrollEl.getBoundingClientRect();
  return {
    scrollHeight: scrollEl.scrollHeight,
    clientHeight: scrollEl.clientHeight,
    visibleHeight: scrollElRect.height,
    backgroundColorOfScrollEl: getComputedStyle(scrollEl).backgroundColor,
  };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
