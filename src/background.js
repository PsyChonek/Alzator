import { SHOPS, extractProductId, productUrl, parseOffer, parseCnbRates, toCzk } from './parse.js';

const CNB_URL =
  'https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt';
const RATES_TTL_MS = 6 * 60 * 60 * 1000;
const PRICE_TTL_MS = 20 * 60 * 1000;

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

async function fetchShop(shop, productId) {
  const url = productUrl(shop.host, productId);
  try {
    const offer = await cached(`price:${shop.host}:${productId}`, PRICE_TTL_MS, async () => {
      // No cookies, so the lookup never touches the user's cart or session on other shops.
      const res = await fetch(url, { credentials: 'omit' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseOffer(await res.text());
    });
    return { ...shop, url: offer?.url ?? url, offer, error: null };
  } catch (err) {
    return { ...shop, url, offer: null, error: String(err.message ?? err) };
  }
}

async function compare(pageUrl) {
  const productId = extractProductId(pageUrl);
  if (!productId) return { productId: null };
  const [rates, shops] = await Promise.all([
    getRates().catch(() => null),
    Promise.all(SHOPS.map((shop) => fetchShop(shop, productId))),
  ]);
  for (const shop of shops) {
    shop.czk = shop.offer && rates ? toCzk(shop.offer.price, shop.offer.currency, rates.rates) : null;
  }
  return { productId, rateDate: rates?.date ?? null, eurCzk: rates?.rates.EUR ?? null, shops };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'alzator:compare') return false;
  compare(msg.url).then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true;
});
