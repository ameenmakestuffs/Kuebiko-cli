# Aegis demo sandbox

A tiny storefront module with a seeded bug in `src/cart.js`.

The test suite expects a discount to **reduce** the subtotal, but `applyDiscount`
currently adds it instead. This is exactly the kind of semantic failure Aegis
triages, patches, and verifies.

```bash
npm test
```

From the repository root:

```bash
aegis run "npm test" --cwd demo-sandbox
```
