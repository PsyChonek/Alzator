# Alzator

Chrome extension that shows the price of the current Alza product on every Alza country shop, converted to CZK.

On any product page (`...-d<id>.htm`) of alza.cz, alza.sk, alza.de, alza.at or alza.hu it adds a box above the price with:

- the price on each shop in local currency and in CZK
- the difference against the shop you are on
- the cheapest shop highlighted, plus "not sold" / "out of stock" where it applies

Prices are VAT inclusive (each country's own VAT). Conversion uses the Czech National Bank daily rate.

## How it works

The product ID is the same on every Alza shop, so `https://www.alza.<tld>/-d<id>.htm` redirects to the product there. The service worker fetches each shop without cookies, reads the schema.org `Product` offer from the page's JSON-LD and converts it with the CNB `denni_kurz.txt` rates. Prices are cached for 20 minutes, rates for 6 hours.

## Install

1. Open `chrome://extensions` and enable Developer mode.
2. Click "Load unpacked" and select this folder.

## Develop

```
npm run check   # syntax check + unit tests, no dependencies needed
```
