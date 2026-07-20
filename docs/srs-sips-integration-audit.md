# SRS SIPS Integration Audit — Payload & Endpoint Verification

**Audit date:** 2026-07-20
**Auditor:** Pitch platform team
**Purpose:** Line-by-line reconciliation of Pitch's SRS (RoofHub SIPS) backend
implementation against the current public SIPS documentation, in preparation
for the next SRS developer call. Every finding below cites the live doc URL it
was verified against.

---

## 1. Source documents (fetched 2026-07-20)

Portal root: <https://apidocs.roofhub.pro/>

| Topic                | Live doc URL                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| SIPS overview        | https://apidocs.roofhub.pro/srs-integration-partner-services-sips-1613923m0        |
| Introduction         | https://apidocs.roofhub.pro/introduction-1994856m0                                 |
| Auth (getting started) | https://apidocs.roofhub.pro/authentication-1994857m0                             |
| Auth (API reference) | https://apidocs.roofhub.pro/authentication-7755216f0                               |
| Token (POST)         | https://apidocs.roofhub.pro/token-32636877e0                                       |
| Order Flow tutorial  | https://apidocs.roofhub.pro/order-flow-1994858m0                                   |
| Submit Order (POST)  | https://apidocs.roofhub.pro/submit-order-32654312e0                                |
| Price (POST)         | https://apidocs.roofhub.pro/price-32656412e0                                       |
| Product Catalog      | https://apidocs.roofhub.pro/catalog-32754922e0                                     |
| Catalog by item codes| https://apidocs.roofhub.pro/by-item-codes-32754978e0                               |
| Catalog Convert      | https://apidocs.roofhub.pro/catalog-item-convert-32754918e0                        |
| Color Recommendations| https://apidocs.roofhub.pro/color-recommendations-32754860e0                       |
| Customer Details     | https://apidocs.roofhub.pro/customer-details-32636888e0                            |
| Validate Customer    | https://apidocs.roofhub.pro/customer-details-32636888e0 (`/customers/validate`)    |
| Delivery Details     | https://apidocs.roofhub.pro/delivery-details-32636879e0                            |
| Deliveries List      | https://apidocs.roofhub.pro/deliveries-list-32636880e0                             |
| Proof of Delivery    | https://apidocs.roofhub.pro/proof-of-delivery-32636881e0                           |
| Order Details        | https://apidocs.roofhub.pro/order-details-32636882e0                               |
| Order List           | https://apidocs.roofhub.pro/order-list-32636883e0                                  |
| Invoice Details      | https://apidocs.roofhub.pro/invoice-details-32636885e0                             |
| Invoices List        | https://apidocs.roofhub.pro/invoices-list-32636886e0                               |
| Web Hooks            | https://apidocs.roofhub.pro/web-hooks-1597567m0                                    |
| Credentials handling | https://apidocs.roofhub.pro/credentials-2120081m0                                  |
| FAQs / SourceSystem  | https://apidocs.roofhub.pro/faqs-1543520m0                                         |

Environments (from every code sample in the portal):

- **Staging (QA):** `https://services-qa.roofhub.pro`
- **Production:**   `https://services.roofhub.pro`

Both match `SRS_STAGING_URL` / `SRS_PRODUCTION_URL` in
`supabase/functions/srs-api-proxy/index.ts` (lines 9–10) — ✅ correct.

---

## 2. Authentication — `POST /authentication/token`

**SIPS spec (verbatim from token-32636877e0):**

```bash
curl --request POST \
  'https://services-qa.roofhub.pro/authentication/token' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=…' \
  --data-urlencode 'client_secret=…' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'scope=ALL'
```

Response `200`:
```json
{ "token_type": "…", "access_token": "…", "expires_in": … }
```

**Pitch implementation** (`supabase/functions/srs-api/index.ts` ~L240):

```ts
body: JSON.stringify({
  client_id, client_secret,
  grant_type: "client_credentials",
  scope: "ALL",
}),
```

**Findings:**

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| A1 | We POST **JSON** to `/authentication/token`. SIPS explicitly requires `application/x-www-form-urlencoded`. QA has been tolerant so far, but this is not spec-compliant and can silently regress. | **High** | Switch to `URLSearchParams` body and set `Content-Type: application/x-www-form-urlencoded`. |
| A2 | We send `scope: "ALL"` (lower-case `scope`) — matches. ✅ | — | — |
| A3 | Token cache honours `expires_in` (see `srs-api` L261) — matches. ✅ | — | — |

---

## 3. Submit Order — `POST /orders/v2/Submit`

**SIPS official example body** (verbatim, submit-order-32654312e0):

```json
{
  "sourceSystem": "SOURCENAME",
  "customerCode": "DEMO001",
  "jobAccountNumber": 1,
  "branchCode": "BRRIV",
  "accountNumber": "DEMO001",
  "transactionID": "3932cdd6-38e7-4d19-a05c-cd866473bdea",
  "transactionDate": "2023-05-11T10:49:34.187",
  "notes": "",
  "shipTo": {
    "name": "John",
    "addressLine1": "1234 COUNTY LINE ROAD",
    "addressLine2": "",
    "addressLine3": "",
    "city": "ONTARIO",
    "state": "NY",
    "zipCode": "14519"
  },
  "poDetails": {
    "poNumber": "5641-8Test",
    "reference": "5641: 7GP",
    "jobNumber": "",
    "orderDate": "2021-04-12",
    "expectedDeliveryDate": "2021-04-15",
    "expectedDeliveryTime": "Anytime",
    "orderType": "WHSE",
    "shippingMethod": "Ground Drop"
  },
  "orderLineItemDetails": [
    {
      "productId": 75664,
      "productName": "CertainTeed Presidential Solaris Shingles",
      "option": "Country Gray",
      "quantity": 1,
      "price": 12,
      "customerItem": "XXXX",
      "uom": "SQ"
    }
  ],
  "customerContactInfo": {
    "customerContactName": "John Dough",
    "customerContactPhone": "9876543210",
    "customerContactEmail": "jdough@example.com",
    "customerContactAddress": {
      "addressLine1": "123 Main St",
      "city": "Salt Lake City",
      "state": "Utah",
      "zipCode": "84121"
    },
    "additionalContactEmails": ["test@example.com"]
  }
}
```

**Pitch implementation:** `buildSubmitOrderPayload()` in
`supabase/functions/srs-api-proxy/index.ts` L56–L120.

### Delta table

| # | Field                          | SIPS doc                                                                 | Pitch today                                                       | Verdict | Recommended action                                                                                                            |
|---|--------------------------------|--------------------------------------------------------------------------|-------------------------------------------------------------------|---------|-------------------------------------------------------------------------------------------------------------------------------|
| O1 | `sourceSystem`                 | Present (`"SOURCENAME"`)                                                 | `"PITCH"` (const `SRS_SOURCE_SYSTEM`, L13)                        | ✅      | Confirm with SRS that our assigned SourceSystem is `PITCH` (Angel Perez onboarding 5/14/2026).                                |
| O2 | `customerCode`                 | Required                                                                 | Sent (L79)                                                        | ✅      | —                                                                                                                             |
| O3 | `jobAccountNumber` (top-level) | **Present** in official example                                          | **Removed** in comment L117–118                                   | ❌ **HIGH** | **Re-add top-level `jobAccountNumber`.** Removal was based on undocumented advice; the current public spec requires it.        |
| O4 | `shipToSequenceNumber`         | **Not present** in official example                                      | Sent as top-level (L80, default `1`)                              | ❌ **HIGH** | Remove from payload OR ask SRS whether it is a permitted extension. Non-spec fields risk silent 400s from Agility.            |
| O5 | `branchCode`                   | Required                                                                 | Sent (L81)                                                        | ✅      | —                                                                                                                             |
| O6 | `accountNumber` (string)       | Required                                                                 | Sent as string (L82)                                              | ✅      | —                                                                                                                             |
| O7 | `transactionID`                | UUID; note casing **`transactionID`** (capital ID)                       | Sent as `transactionID` (L83)                                     | ✅      | —                                                                                                                             |
| O8 | `transactionDate`              | ISO datetime                                                             | Sent (L84)                                                        | ✅      | —                                                                                                                             |
| O9 | `notes`                        | String (may be empty)                                                    | Sent (L85)                                                        | ✅      | —                                                                                                                             |
| O10 | `shipTo.name`                  | Present in example                                                       | Not populated in our default (L86–89); only added if caller provides | ⚠️ Med  | Populate `shipTo.name` from Contact / Job site contact whenever available.                                                    |
| O11 | `shipTo.addressLine1/2/3`, `city`, `state`, `zipCode` | Structured                                    | Structured (L86–89, plus `parseShipToFreeform()`)                 | ✅      | —                                                                                                                             |
| O12 | `poDetails.*`                  | `poNumber`, `reference`, `jobNumber`, `orderDate`, `expectedDeliveryDate`, `expectedDeliveryTime`, `orderType`, `shippingMethod` | All 8 fields sent (L90–99) | ✅      | —                                                                                                                             |
| O13 | `orderLineItemDetails[].productId` | **Numeric** (e.g. `75664`)                                          | Coerced to number when possible (L104–106); falls back to raw string | ✅   | —                                                                                                                             |
| O14 | `orderLineItemDetails[].productName` | Present                                                             | Sent (L107)                                                       | ✅      | —                                                                                                                             |
| O15 | `orderLineItemDetails[].option` | Colour / variant string ("Country Gray")                                | Sent, defaults to `"N/A"` (L108)                                  | ✅      | Confirm SRS accepts `"N/A"` for non-colour SKUs; some Agility rules require an empty string instead.                          |
| O16 | `orderLineItemDetails[].quantity` | Number                                                                | Sent (L109)                                                       | ✅      | —                                                                                                                             |
| O17 | `orderLineItemDetails[].price` | **Present** in official example (`"price": 12`)                          | **Stripped** — comment L100–102 says "SRS prices server-side"     | ❌ **HIGH** | Ask SRS: is `price` (a) required, (b) advisory, or (c) forbidden? Public doc example includes it; Jessica Zapata's 2026-05-18 email said the opposite. Need written confirmation. |
| O18 | `orderLineItemDetails[].customerItem` | Present                                                          | Sent, defaults to `""` (L111)                                     | ✅      | —                                                                                                                             |
| O19 | `orderLineItemDetails[].uom`   | Two-letter codes (`SQ`, `BD`, `EA`, `PC`, `RL`, …)                       | Sent, normalized via `normalizeUom()` (L110, L157–201)            | ✅      | Mapping table is comprehensive — retain.                                                                                       |
| O20 | `customerContactInfo`          | Structured object incl. `customerContactAddress` + `additionalContactEmails[]` | Passed through as-is (L115)                                | ✅      | Populate address & additionalContactEmails from Contact record where available.                                               |

### Order type / shipping-method mapping

`srsOrderType()` (L123) and `srsShippingMethodLabel()` (L129) match the spec's
allowed values: `WHSE`/`WILLCALL` for orderType, and the string labels
`Ground Drop`, `Roof Load`, `Will Call` for shippingMethod. Rejecting the
generic `"delivery"` string before submit is correct.

---

## 4. Price — `POST /products/v2/price`

**SIPS official example body** (verbatim, price-32656412e0):

```json
{
  "sourceSystem": "SOURCENAME",
  "customerCode": "DEMO001",
  "branchCode": "HWPLY",
  "transactionId": "SPR-1",
  "jobAccountNumber": 1,
  "productList": [
    {
      "productId": 77673,
      "productName": "Ace Insulation Plates",
      "productOptions": ["N/A"],
      "quantity": 1,
      "uom": "PC"
    }
  ]
}
```

**Pitch implementation:** `supabase/functions/srs-api/index.ts` L273–L284.

```ts
const pricingPayload = {
  sourceSystem: SRS_SOURCE_SYSTEM,
  transactionId: crypto.randomUUID(),
  customerCode, jobAccountNumber: jan, branchCode,
  productList: priceable.map((p) => ({
    productNumber: p.productNumber,  // ← delta P1
    quantity: p.quantity,
    uom: p.uom,
  })),
};
```

### Delta table

| # | Field                    | SIPS doc                                        | Pitch today                                   | Verdict     | Recommended action                                                                                                     |
|---|--------------------------|-------------------------------------------------|-----------------------------------------------|-------------|------------------------------------------------------------------------------------------------------------------------|
| P1 | `productList[].productId` | Numeric SRS product id                          | We send `productNumber` (string SKU), no `productId` | ❌ **CRITICAL** | Send `productId` (numeric). Our `template_item_supplier_mappings.supplier_product_id` already captures the numeric id — surface it into the payload. |
| P2 | `productList[].productName` | Present                                       | Not sent                                      | ⚠️ Med     | Optional but helpful for SRS error messages — add when available.                                                      |
| P3 | `productList[].productOptions` | Array of colour/variant strings, e.g. `["Country Gray"]` | Not sent                             | ⚠️ Med     | Send `productOptions: [option]` (or `["N/A"]`) when the estimate line has a colour.                                     |
| P4 | `productList[].quantity` / `uom` | Present                                    | Sent, `uom` normalized                        | ✅          | —                                                                                                                      |
| P5 | Top-level `transactionId` (lowercase d) | Present                              | Sent as `transactionId` (matches lowercase)   | ✅          | Note: Submit Order uses **`transactionID`** (capital), Price uses **`transactionId`** (lowercase). We already do both correctly. |
| P6 | Top-level `jobAccountNumber` | Present                                       | Sent                                          | ✅          | —                                                                                                                      |
| P7 | Custom headers `Source-System`, `X-Source-System` | Not in doc                    | Sent (srs-api L290–291)                       | ⚠️ Low     | Harmless but not spec — safe to keep for observability.                                                                |

---

## 5. Cross-endpoint hygiene

| Area | Status | Notes |
|------|--------|-------|
| OAuth2 client-credentials flow | ✅ | Uses tenant/partner `client_id` + `client_secret`, cached via `access_token` + `token_expires_at`. |
| `Authorization: Bearer <token>` header | ✅ | Set on every request. |
| `sourceSystem` on every authenticated call | ✅ | Constant `PITCH` matches SRS FAQ definition of SourceSystem. |
| Environment switching by connection row | ✅ | `srs_connections.environment` selects `services-qa` vs `services`. |
| Audit trail (`srs_credential_audit`, `srs_submit_audit`) | ✅ | Every credential change, price call and submit is logged. |
| UOM normalization before submit | ✅ | 30+ synonyms mapped to SRS codes (EA, PC, SQ, BD, RL, LF, GA, BG, TB, PL, BX, SHT). |
| Idempotency for `/orders/v2/Submit` | ⚠️ | We generate a fresh `transactionID` per attempt. Confirm with SRS if they de-duplicate on `transactionID` — if yes we must persist and re-use it on retry. |
| Webhook receiver | ⚠️ | `abc_webhook_events` exists but SRS webhook subscription is TODO. See webhook doc (Section 6 below). |

---

## 6. Open questions for the SRS developer call

1. **Price on Submit Order** — Public example includes `price` on each line;
   Jessica Zapata's 2026-05-18 email told us to omit it. Which is authoritative?
2. **`shipToSequenceNumber`** — Not shown in the public example. Is it a
   permitted extension, or should we drop it and rely on `customerCode` +
   `branchCode` to resolve the ship-to?
3. **Top-level `jobAccountNumber`** — Confirm this is still required.
4. **`option` = `"N/A"`** — Confirm accepted for non-colour SKUs, or should we
   send an empty string?
5. **Price payload** — Confirm `productId` (numeric) is required, and that
   `productOptions[]` is the field name for colour variants.
6. **Auth content-type** — Confirm `application/x-www-form-urlencoded` is the
   only accepted format for `/authentication/token`; JSON is currently working
   in QA but is not documented.
7. **Idempotency on submit** — Do you dedupe by `transactionID`? What is the
   expected retry behaviour on 5xx?
8. **Webhook endpoints** — Please share the QA webhook registration URL and
   secret rotation policy so we can wire our `srs_webhook_events` table.

---

## 7. Concrete code changes proposed (for post-call implementation)

_None applied in this audit — this document is verification only. Once SRS
confirms answers to Section 6, open a follow-up ticket to apply:_

1. `supabase/functions/srs-api/index.ts` L246 — switch token POST to
   `application/x-www-form-urlencoded`.
2. `supabase/functions/srs-api/index.ts` L279–283 — replace `productNumber`
   with `productId` (numeric) and add `productName` + `productOptions`.
3. `supabase/functions/srs-api-proxy/index.ts` L77–120 —
   - re-add top-level `jobAccountNumber` (from `srs_connections` or branch);
   - drop `shipToSequenceNumber` (pending SRS confirmation);
   - conditionally include `price` on line items (pending SRS confirmation);
   - populate `shipTo.name` from job contact by default.

All proposed changes are **behind the SRS developer call** — do not ship until
answers are recorded here.
