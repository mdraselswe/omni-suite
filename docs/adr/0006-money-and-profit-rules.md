# 6. Money, ownership and configurable profit sharing

## Decision

- Amounts are `bigint` minor units plus an ISO currency. Transactions in another currency keep the original amount and the converted base amount (rate at the transaction date).
- Ledgers are append-only. A wrong entry is fixed by a reversal entry. Periods can be closed; closed periods reject new or reversed entries.
- **Ownership** (who owns the business) is stored as units in effective-dated `ownership_periods`. Admitting a partner records an `ownership_events` row with the agreed pre-money valuation; existing holders are diluted pro rata, or units are transferred from one holder.
- **Profit rules** are versioned JSON (zod-validated) with `effective_from`. A new version needs approval from every active partner and only applies from its effective date; closed periods never change.
  - Waterfall: reserve % → fixed partner fees → split the rest.
  - Split methods: `capital_ratio`, `ownership_units`, `fixed_percent` (partners set the percentages, total 100), `weighted` (capital weight + labour weight; labour from logged hours or entered points).
  - Loss handling: by ownership or by the same split.
- A **distribution run** stores its inputs, the rule version and the result, so history never shifts.

## Why

Ownership and profit share are different agreements: one partner can invest money while another invests work, and they may still split 50/50. Keeping them separate and versioned makes any agreement expressible and auditable. The calculation is a pure function (`src/features/partners/profit.ts`) with tests built from the agreed examples.
