// Pure helpers shared by the service worker and the tests. No browser APIs here.

export const SHOPS = [
  { host: 'www.alza.cz', country: 'CZ', currency: 'CZK' },
  { host: 'www.alza.sk', country: 'SK', currency: 'EUR' },
  { host: 'www.alza.de', country: 'DE', currency: 'EUR' },
  { host: 'www.alza.at', country: 'AT', currency: 'EUR' },
  { host: 'www.alza.hu', country: 'HU', currency: 'HUF' },
];

// Alza product URLs end with "-d<id>.htm", the slug before it is ignored by the server.
export function extractProductId(url) {
  const { pathname, searchParams } = new URL(url);
  const match = pathname.match(/-d(\d+)\.htm$/i);
  if (match) return match[1];
  const dq = searchParams.get('dq');
  return dq && /^\d+$/.test(dq) ? dq : null;
}

export function productUrl(host, productId) {
  return `https://${host}/-d${productId}.htm`;
}

// Reads the schema.org Product offer from a product page. Prices on Alza are VAT inclusive.
export function parseOffer(html) {
  const scripts = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of scripts) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    for (const node of [data, ...(data['@graph'] ?? [])].flat()) {
      if (node?.['@type'] !== 'Product' || !node.offers) continue;
      const offer = [node.offers].flat()[0];
      const price = Number(offer.price ?? offer.lowPrice);
      if (!Number.isFinite(price) || !/^[A-Z]{3}$/.test(offer.priceCurrency ?? '')) continue;
      return {
        name: node.name ?? null,
        price,
        currency: offer.priceCurrency,
        inStock: /InStock$/i.test(offer.availability ?? ''),
        url: offer.url ?? node.url ?? null,
      };
    }
  }
  return null;
}

// Parses the CNB daily rate file into CZK per 1 unit of each currency.
// Format: "země|měna|množství|kód|kurz" with a decimal comma.
export function parseCnbRates(text) {
  const rates = { CZK: 1 };
  const lines = text.split('\n');
  const date = lines[0]?.split(' ')[0] ?? null;
  for (const line of lines.slice(2)) {
    const parts = line.trim().split('|');
    if (parts.length !== 5) continue;
    const amount = Number(parts[2]);
    const rate = Number(parts[4].replace(',', '.'));
    if (amount > 0 && Number.isFinite(rate)) rates[parts[3]] = rate / amount;
  }
  return { date, rates };
}

export function toCzk(price, currency, rates) {
  return Object.hasOwn(rates, currency) ? price * rates[currency] : null;
}

// Only https links on the shop that was fetched are trusted as the product link.
export function safeShopUrl(candidate, host, fallback) {
  if (typeof candidate !== 'string' || !candidate) return fallback;
  try {
    const url = new URL(candidate, fallback);
    return url.protocol === 'https:' && url.host === host ? url.href : fallback;
  } catch {
    return fallback;
  }
}
