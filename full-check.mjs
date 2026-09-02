import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 620 } });
await page.goto('http://localhost:3800/');
await page.waitForTimeout(300);
await page.click('.assistant-tab');
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const scrollEl = document.querySelector('.assistant-panel .overflow-y-auto');
  const grid = scrollEl.querySelector('.tech-grid');
  const noise = scrollEl.querySelector('[class*="-z-10"]');
  return {
    scrollHeight: scrollEl.scrollHeight,
    gridHeight: grid?.getBoundingClientRect().height,
    noiseHeight: noise?.getBoundingClientRect().height,
  };
});
console.log('scrollHeight (эталон):', info.scrollHeight);
console.log('tech-grid высота:', info.gridHeight, info.gridHeight >= info.scrollHeight - 1 ? '✅' : '❌ короче');
console.log('шумовая текстура высота:', info.noiseHeight, info.noiseHeight >= info.scrollHeight - 1 ? '✅' : '❌ короче');

// Реальная прокрутка всё ещё работает?
const box = await page.evaluate(() => {
  const r = document.querySelector('.assistant-panel .overflow-y-auto').getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
await page.mouse.move(box.x, box.y);
const before = await page.$eval('.assistant-panel .overflow-y-auto', el => el.scrollTop);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(300);
const after = await page.$eval('.assistant-panel .overflow-y-auto', el => el.scrollTop);
console.log('Прокрутка всё ещё работает:', after > before ? '✅' : '❌');

await browser.close();
