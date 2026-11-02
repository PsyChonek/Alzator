// Pure helpers shared by the service worker and the tests. No browser APIs here.

// codeSuffixes: Alza sells regional variants under a different product ID whose Alza code is the
// base code plus a country suffix (SAMO0285c1 on CZ/SK, SAMO0285c1DE on DE/AT, SAMO0285c1HU on HU).
export const SHOPS = [
  { host: 'www.alza.cz', country: 'CZ', currency: 'CZK', codeSuffixes: [''] },
  { host: 'www.alza.sk', country: 'SK', currency: 'EUR', codeSuffixes: ['', 'SK'] },
  { host: 'www.alza.de', country: 'DE', currency: 'EUR', codeSuffixes: ['DE', ''] },
  { host: 'www.alza.at', country: 'AT', currency: 'EUR', codeSuffixes: ['DE', 'AT', ''] },
  { host: 'www.alza.hu', country: 'HU', currency: 'HUF', codeSuffixes: ['HU', ''] },
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

// /kod/<code> redirects to the product with that Alza code, or returns 404.
export function codeUrl(host, code) {
  return `https://${host}/kod/${encodeURIComponent(code)}`;
}

// Strips the shop's own regional suffix so codes from different shops can be compared.
export function baseCode(sku, shop) {
  if (!sku) return null;
  const suffix = shop.codeSuffixes.find((s) => s && sku.length > s.length && sku.endsWith(s));
  return suffix ? sku.slice(0, -suffix.length) : sku;
}

export function variantCodes(base, shop) {
  return [...new Set(shop.codeSuffixes.map((s) => base + s))];
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
        sku: typeof node.sku === 'string' ? node.sku : null,
        price,
        currency: offer.priceCurrency,
        inStock: /InStock$/i.test(offer.availability ?? ''),
        url: offer.url ?? node.url ?? null,
      };
    }
  }
  return null;
}

// Parses a displayed price like "39 490,-", "1.134,98 €" or "537 290 Ft".
export function parseLocalNumber(text) {
  const token = text?.match(/\d[\d\s .,]*/)?.[0].trim().replace(/[.,]$/, '');
  if (!token) return null;
  const decimal = token.match(/[.,](\d{1,2})$/);
  const whole = (decimal ? token.slice(0, -decimal[0].length) : token).replace(/[^\d]/g, '');
  const value = Number(decimal ? `${whole}.${decimal[1]}` : whole);
  return Number.isFinite(value) ? value : null;
}

// The main price box. With "ads-pb--alza-plus" the big price is the AlzaPlus+ member price and
// "ads-pb__original-price" holds the price without membership ("Bez členství: 39 490,-").
// Without it, "ads-pb__original-price" is something else (e.g. "Ušetříte 479,-") and is ignored.
export function parsePriceBox(html) {
  const start = html.search(/class="ads-pb js-price-box[^"]*"/);
  if (start < 0) return { alzaPlus: false, withoutMembership: null };
  const classes = html.slice(start, html.indexOf('"', start + 7));
  if (!classes.includes('ads-pb--alza-plus')) return { alzaPlus: false, withoutMembership: null };
  const box = html.slice(start, start + 4000);
  const original = box.match(/class="ads-pb__original-price"[^>]*>([^<]*)</)?.[1];
  return { alzaPlus: true, withoutMembership: parseLocalNumber(original) };
}

// Prices as one visitor sees them: "price" is what they pay without AlzaPlus+, "alzaPlus" with it.
export function parseProductPage(html) {
  const offer = parseOffer(html);
  if (!offer) return null;
  const box = parsePriceBox(html);
  if (box.alzaPlus && box.withoutMembership) {
    return { ...offer, price: box.withoutMembership, alzaPlus: offer.price };
  }
  return { ...offer, alzaPlus: null };
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
  return price != null && Object.hasOwn(rates, currency) ? price * rates[currency] : null;
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
