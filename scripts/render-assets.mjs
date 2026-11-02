// Renders the README images and extension icons with headless Chrome.
// The widget screenshots run the real src/content.js against sample data, with chrome.* stubbed.
// Usage: npm run assets
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = (p) => `${root}${p}`;

const RATES = { CZK: 1, EUR: 24.36, HUF: 0.06649 };

// Sample prices from 2 Nov 2026 for the Samsung Galaxy S26 Ultra 12GB/512GB Black.
function sampleData() {
  const shop = (host, currency, { anon, mine = anon, alzaPlus = null, variant = false, sku }) => {
    const price = (value) => (value == null ? null : { value, czk: value * RATES[currency] });
    return {
      host, currency, variant, sku, found: true, inStock: true,
      url: `https://${host}/-d13233596.htm`,
      anon: price(anon), mine: price(mine), alzaPlus: price(alzaPlus),
    };
  };
  return {
    productId: '13233596',
    rateDate: '30.10.2026',
    eurCzk: RATES.EUR,
    shops: [
      shop('www.alza.cz', 'CZK', { anon: 42211, mine: 39490, alzaPlus: 35541, sku: 'SAMO0285c1' }),
      shop('www.alza.sk', 'EUR', { anon: 1789, sku: 'SAMO0285c1' }),
      shop('www.alza.de', 'EUR', { anon: 1134.98, variant: true, sku: 'SAMO0285c1DE' }),
      shop('www.alza.at', 'EUR', { anon: 1129.98, variant: true, sku: 'SAMO0285c1DE' }),
      shop('www.alza.hu', 'HUF', { anon: 599990, variant: true, sku: 'SAMO0285c1HU' }),
    ],
  };
}

async function widgetPage(lang) {
  const messages = JSON.parse(await readFile(path(`_locales/${lang}/messages.json`), 'utf8'));
  const content = await readFile(path('src/content.js'), 'utf8');
  const fakeLocation = {
    host: 'www.alza.cz',
    href: 'https://www.alza.cz/samsung-galaxy-s26-ultra-12gb-512gb-black-d13233596.htm',
    pathname: '/samsung-galaxy-s26-ultra-12gb-512gb-black-d13233596.htm',
    search: '',
  };
  const stub = `
    const MESSAGES = ${JSON.stringify(messages)};
    window.chrome = {
      i18n: {
        getUILanguage: () => ${JSON.stringify(lang)},
        getMessage(key, subs = []) {
          const m = MESSAGES[key];
          if (!m) return '';
          return m.message.replace(/\\$(\\w+)\\$/g, (_, name) => {
            const index = m.placeholders?.[name.toLowerCase()]?.content.match(/\\$(\\d)/)?.[1];
            return subs[index - 1] ?? '';
          });
        },
      },
      runtime: { sendMessage: async () => (${JSON.stringify(sampleData())}) },
    };`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin: 0; padding: 24px; background: transparent; }
      #frame { width: 560px; border-radius: 14px; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18); }
      .price-detail__buy-actions { height: 0; }
    </style></head><body>
    <div id="frame"><div class="price-detail__buy-actions"></div></div>
    <script>${stub}</script>
    <script>(function (location) {${content}\n})(${JSON.stringify(fakeLocation)});</script>
    </body></html>`;
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });

for (const lang of ['en', 'cs']) {
  await page.setContent(await widgetPage(lang));
  await page.waitForFunction(() => document.getElementById('alzator-root')?.shadowRoot.querySelector('table'));
  await page.locator('#frame').screenshot({ path: path(`docs/screenshot-${lang}.png`), omitBackground: true, style: '' });
  console.log(`docs/screenshot-${lang}.png`);
}

await page.setViewportSize({ width: 1280, height: 640 });
await page.goto(pathToFileURL(path('docs/banner.html')).href);
await page.waitForLoadState('load');
await page.screenshot({ path: path('docs/banner.png') });
console.log('docs/banner.png');

await mkdir(path('icons'), { recursive: true });
const logo = await readFile(path('docs/logo.svg'), 'utf8');
for (const size of [16, 32, 48, 128]) {
  const icon = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await icon.setContent(`<style>body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${logo}`);
  await icon.screenshot({ path: path(`icons/icon-${size}.png`), omitBackground: true });
  await icon.close();
  console.log(`icons/icon-${size}.png`);
}

await browser.close();
