import {
  SHOPS,
  extractProductId,
  productUrl,
  codeUrl,
  baseCode,
  variantCodes,
  parseProductPage,
  parseCnbRates,
  toCzk,
  safeShopUrl,
} from './parse.js';

const CNB_URL =
  'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt';
const RATES_TTL_MS = 6 * 60 * 60 * 1000;
const PAGE_TTL_MS = 10 * 60 * 1000;

async function cached(key, ttlMs, load) {
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored && Date.now() - stored.at < ttlMs) return stored.value;
  const value = await load();
  await chrome.storage.local.set({ [key]: { at: Date.now(), value } });
  return value;
}

function getRates() {
  return cached('cnb-rates', RATES_TTL_MS, async () => {
    const res = await fetch(CNB_URL);
    if (!res.ok) throw new Error(`CNB ${res.status}`);
    return parseCnbRates(await res.text());
  });
}

// asUser: send the user's Alza cookies, so the page shows their own (logged in, AlzaPlus+) prices.
// Without cookies it is what an anonymous visitor sees. Only GETs of product pages, nothing else.
function loadPage(url, asUser) {
  return cached(`page:${asUser ? 'user' : 'anon'}:${url}`, PAGE_TTL_MS, async () => {
    const res = await fetch(url, { credentials: asUser ? 'include' : 'omit' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseProductPage(await res.text());
  });
}

// Same product ID first; if the shop doesn't have it, look for a regional variant by Alza code.
async function findProduct(shop, productId, base) {
  const page = await loadPage(productUrl(shop.host, productId), true);
  if (page || !base) return { page, variant: false };
  for (const code of variantCodes(base, shop)) {
    const candidate = await loadPage(codeUrl(shop.host, code), true);
    if (candidate && baseCode(candidate.sku, shop) === base) return { page: candidate, variant: true };
  }
  return { page: null, variant: false };
}

async function resolveShop(shop, productId, base, rates) {
  const fallbackUrl = productUrl(shop.host, productId);
  try {
    const { page, variant } = await findProduct(shop, productId, base);
    if (!page) return { ...shop, url: fallbackUrl, found: false };
    const url = safeShopUrl(page.url, shop.host, fallbackUrl);
    const anon = await loadPage(url, false).catch(() => null);
    const price = (value) => (value == null ? null : { value, czk: rates ? toCzk(value, page.currency, rates) : null });
    return {
      ...shop,
      url,
      found: true,
      variant,
      sku: page.sku,
      currency: page.currency,
      inStock: page.inStock,
      anon: price(anon?.price),
      mine: price(page.price),
      alzaPlus: price(page.alzaPlus),
    };
  } catch (err) {
    return { ...shop, url: fallbackUrl, found: false, error: String(err.message ?? err) };
  }
}

async function compare(pageUrl) {
  const productId = extractProductId(pageUrl);
  const current = SHOPS.find((s) => s.host === new URL(pageUrl).host);
  if (!productId || !current) return { productId: null };

  const ratesPromise = getRates().catch(() => null);
  const own = await loadPage(productUrl(current.host, productId), true).catch(() => null);
  const base = baseCode(own?.sku, current);
  const rates = await ratesPromise;
  const shops = await Promise.all(SHOPS.map((shop) => resolveShop(shop, productId, base, rates?.rates)));
  return { productId, rateDate: rates?.date ?? null, eurCzk: rates?.rates.EUR ?? null, shops };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'alzator:compare') return false;
  compare(msg.url).then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true;
});
