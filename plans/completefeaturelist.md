# POS System - Complete Approved Feature List

Source: `POS_Approved_Feature_List - Copy.pdf`  
Version: 1.0 | October 2026

This file transcribes the approved functional scope. It contains 138 features across 14 modules. Features not listed here are out of scope for this build. The priority values are `Essential`, `Recommended`, `Advanced`, and `Optional`.

## Contents

1. Sales & Checkout - 14 features
2. Pricing Engine - 8 features
3. Discounts, Promotions & Coupons - 6 features
4. Taxes, Fees & Charges - 8 features
5. Product & Catalog Management - 16 features
6. Inventory Management - 15 features
7. Warehouses, Stores & Transfers - 10 features
8. Returns, Refunds & Exchanges - 14 features
9. Customer / CRM - 8 features
10. Loyalty, Memberships, Gift Cards & Wallets - 5 features
11. Registers, Tills, Cash & Store Operations - 6 features
12. Staff, Workforce, Permissions & Approvals - 12 features
13. Reporting, Analytics & BI - 5 features
14. Dashboards, Alerts & Exception Management - 11 features

## 1. Sales & Checkout

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 1.1 | New / quick sale | Start a normal transaction immediately with minimal clicks. | Essential | - | - |
| 1.2 | Barcode / QR scanning | Add items using manufacturer, internal, weighted, price-embedded or QR codes. | Essential | - | - |
| 1.3 | Product search | Search by name, SKU, barcode, alias, category, brand, variant or PLU. | Essential | - | - |
| 1.4 | Quick keys / favorites | Configurable product tiles for frequently sold items. | Recommended | - | - |
| 1.5 | Visual product grid | Image/category-based selling interface for touch devices. | Recommended | - | - |
| 1.6 | Cart management | Add, remove, change quantity and reorder lines; show running totals. | Essential | - | - |
| 1.7 | Hold / suspend / resume | Park an unfinished sale and continue later or on another authorized register. | Essential | - | - |
| 1.8 | Open price product | Allow manual price for configured products. | Advanced | Role permission / price floor | Useful for services or variable goods; risk of misuse. |
| 1.9 | Product variants | Choose size, color, model, capacity or other variant during selling. | Essential | - | - |
| 1.10 | Bundles / kits / combos | Sell multiple components as one offer while deducting components from inventory. | Recommended | BOM/bundle definition | More complex returns and stock costing. |
| 1.11 | Weighted / measured sales | Sell by weight, length, volume or decimal units. | Recommended | Scale/UOM | Necessary for grocery, fabric, cable, produce and bulk goods. |
| 1.12 | Line notes / order notes | Store customer-facing or internal notes at item and transaction level. | Essential | - | - |
| 1.13 | Fast keyboard shortcuts | Keyboard-driven operations for high-volume tills. | Recommended | - | - |
| 1.14 | Touch/mobile POS | Responsive checkout mode for tablets and handhelds. | Recommended | - | - |

## 2. Pricing Engine

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 2.1 | Base retail price | Standard selling price per item/variant. | Essential | - | - |
| 2.2 | Location-specific price | Different prices by store/outlet. | Recommended | - | - |
| 2.3 | Channel-specific price | Different price for POS, ecommerce, marketplace or B2B. | Advanced | Channel master and pricing priority | Useful for omnichannel; rule complexity increases. |
| 2.4 | Customer-specific price | Contract or negotiated price for a named customer. | Advanced | Customer pricing agreements | Necessary for B2B/wholesale; requires conflict-resolution rules. |
| 2.5 | Customer-group / tier price | VIP, wholesale, employee or membership pricing. | Recommended | - | - |
| 2.6 | Quantity / volume pricing | Price breaks based on quantity purchased. | Recommended | - | - |
| 2.7 | Time-based pricing | Scheduled pricing by date/time, such as happy hour or seasonal pricing. | Advanced | Scheduler and conflict priority | Useful for hospitality/promotions; needs clear precedence. |
| 2.8 | Cost-plus pricing | Derive selling price from cost plus markup. | Advanced | Reliable item cost | Cost changes can unexpectedly alter prices. |

## 3. Discounts, Promotions & Coupons

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 3.1 | Promo / coupon code | Manual or scanned promotion code with eligibility validation. | Recommended | - | - |
| 3.2 | Location/channel promotion | Promotion restricted to store/channel. | Advanced | Location/channel context | Needed for omnichannel and multi-store. |
| 3.3 | Promotion stacking | Define combinable, exclusive and priority rules. | Advanced | Pricing/promotion precedence model | Necessary once multiple promotion types coexist. |
| 3.4 | Usage limits | Per-customer, per-coupon or total redemption limits. | Recommended | - | - |
| 3.5 | Promotion approval | Require manager authorization for exceptional/manual discounts. | Recommended | - | - |
| 3.6 | Discount reason codes | Configured reasons for manual discounts and overrides. | Recommended | - | - |

## 4. Taxes, Fees & Charges

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 4.1 | Tax groups | Assign tax behavior by product/service category. | Essential | - | - |
| 4.2 | Tax-inclusive pricing | Price shown includes tax. | Essential | - | - |
| 4.3 | Tax-exclusive pricing | Tax added to base selling price. | Essential | - | - |
| 4.4 | Tax override | Authorized exception with audit trail. | Advanced | Manager approval | High compliance risk; restrict heavily. |
| 4.5 | Service charge | Fixed or percentage service charge with tax treatment. | Recommended | - | - |
| 4.6 | Delivery / handling fee | Configurable delivery or handling charge. | Recommended | - | - |
| 4.7 | Cash rounding | Round payable amount to supported cash denomination. | Recommended | Currency rounding rules | - |
| 4.8 | Tax invoice / credit note | Generate jurisdiction-appropriate tax documents. | Recommended | Country-specific regulations | Mandatory where local regulations require. |

## 5. Product & Catalog Management

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 5.1 | Product master | Name, SKU, barcode, description, tax, cost, price and status. | Essential | - | - |
| 5.2 | Categories | Hierarchical organization for search, reporting and pricing. | Essential | - | - |
| 5.3 | Brands / manufacturers | Brand and manufacturer master. | Recommended | - | - |
| 5.4 | Variants | Size, color, style, capacity and configurable attributes. | Essential | - | - |
| 5.5 | Multiple barcodes | More than one scan code per item/variant. | Recommended | - | - |
| 5.6 | Units of measure | Piece, kg, litre, metre, pack and conversion rules. | Recommended | - | - |
| 5.7 | Product images | Multiple product images for POS/back office. | Recommended | - | - |
| 5.8 | Bundles / kits | Composite sellable products with component definitions. | Recommended | - | - |
| 5.9 | Services / non-stock | Sell services or non-inventory products/charges. | Recommended | - | - |
| 5.10 | Serialized products | Require unique serial/IMEI per unit. | Advanced | Serial inventory ledger | Necessary for electronics, warranty and asset traceability. |
| 5.11 | Lot / batch products | Track lot/batch for traceability. | Advanced | Batch inventory | Necessary for food, pharma and regulated goods. |
| 5.12 | Expiry-controlled products | Track expiry and optionally FEFO. | Advanced | Batch + expiry data | Needed for perishable/regulated products. |
| 5.13 | Product lifecycle state | Draft, active, discontinued, seasonal and blocked. | Recommended | - | - |
| 5.14 | Country of origin / customs fields | Additional trade/product attributes. | Advanced | Business/regulatory requirement | - |
| 5.15 | Warranty profile | Warranty duration, terms and serial linkage. | Advanced | Warranty/service workflows | - |
| 5.16 | Bulk import / edit | CSV/Excel import and mass changes with validation. | Recommended | - | - |

## 6. Inventory Management

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 6.1 | Real-time on-hand stock | Update stock from sales, returns, receipts, adjustments and transfers. | Essential | - | - |
| 6.2 | Available stock | Calculate sellable stock after reservations/holds. | Recommended | - | - |
| 6.3 | Reserved / committed stock | Track quantities held for open orders. | Recommended | - | - |
| 6.4 | Incoming stock | Track expected receipts from suppliers/transfers. | Recommended | - | - |
| 6.5 | In-transit stock | Track stock moving between locations. | Recommended | - | - |
| 6.6 | Damaged / quarantine stock | Separate non-sellable stock statuses. | Recommended | - | - |
| 6.7 | Negative stock control | Block or warn sales that exceed available stock. | Recommended | - | - |
| 6.8 | Stock adjustments | Controlled increase/decrease with reason codes. | Essential | - | - |
| 6.9 | Adjustment approval | Require approval for large/sensitive adjustments. | Advanced | Approval thresholds | Useful for loss prevention. |
| 6.10 | Inventory transaction ledger | Immutable history of every ledger movement. | Essential | - | - |
| 6.11 | Low-stock alert | Notify when item reaches threshold. | Recommended | - | - |
| 6.12 | Safety stock / reorder point | Maintain minimum target per location. | Recommended | - | - |
| 6.13 | Stock aging | Age inventory by receipt/last movement. | Advanced | Reliable cost/receipt history | - |
| 6.14 | Slow / dead stock | Identify items with low/no movement. | Advanced | Analytics | - |
| 6.15 | Sell-through / days of cover | Measure inventory velocity and cover. | Advanced | Analytics | - |

## 7. Warehouses, Stores & Transfers

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 7.1 | Multiple stock locations | Stores, warehouses, stockrooms and virtual locations. | Recommended | - | - |
| 7.2 | Bins / shelves | Track location within warehouse/store. | Advanced | Location discipline / scanning | Useful for larger inventory operations. |
| 7.3 | Transfer request | Request stock movement between locations. | Recommended | - | - |
| 7.4 | Transfer approval | Approval before dispatch. | Advanced | - | - |
| 7.5 | Pick / dispatch transfer | Confirm what was physically sent. | Recommended | - | - |
| 7.6 | Receive transfer | Confirm received quantities and discrepancies. | Recommended | - | - |
| 7.7 | Partial transfer | Support partial dispatch/receipt. | Recommended | - | - |
| 7.8 | Transfer in transit | Separate dispatched but not received inventory. | Recommended | - | - |
| 7.9 | Transfer discrepancy | Short/over/damaged receiving workflow. | Advanced | - | - |
| 7.10 | Intercompany transfer | Transfer across legal entities. | Advanced | Accounting/tax/intercompany rules | Enterprise only; significant financial complexity. |

## 8. Returns, Refunds & Exchanges

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 8.1 | Receipt-based return | Locate original transaction and return eligible items. | Essential | - | - |
| 8.2 | Partial return | Return only selected items/quantities. | Essential | - | - |
| 8.3 | Exchange | Return and replace in one controlled transaction. | Recommended | - | - |
| 8.4 | Refund to original tender | Refund through original method where supported. | Recommended | - | - |
| 8.5 | Refund to store credit | Issue customer wallet/store credit. | Recommended | - | - |
| 8.6 | Cross-location return | Return item purchased at another store. | Advanced | Shared order/inventory/payment policy | Recommended for chains; finance settlement may be more complex. |
| 8.7 | Cross-channel return | Return ecommerce purchase in store. | Advanced | Omnichannel order/payment integration | - |
| 8.8 | No-receipt return | Allow unverified return with policy controls. | Advanced | Customer identification / manager approval | Higher fraud risk; use limits and approvals. |
| 8.9 | Return eligibility engine | Time window, condition, category and non-returnable rules. | Recommended | - | - |
| 8.10 | Return reason codes | Defect, wrong size, changed mind, damage and other reasons. | Recommended | - | - |
| 8.11 | Restock decision | Return to sellable, damaged, quarantine or vendor return stock. | Recommended | - | - |
| 8.12 | High-value approval | Manager approval above configured amount. | Recommended | - | - |
| 8.13 | Serial/batch validation | Verify returned unique/lot item matches original sale. | Advanced | Serialized/batch inventory | - |
| 8.14 | Post-void | Void completed transaction under strict policy. | Advanced | Accounting/payment rules | High-risk; may be restricted by fiscal rules. |

## 9. Customer / CRM

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 9.1 | Customer profile | Name, phone, email, address and identifiers. | Recommended | - | - |
| 9.2 | Fast customer creation | Create customer from checkout. | Recommended | - | - |
| 9.3 | Purchase history | View transactions, returns and orders. | Recommended | - | - |
| 9.4 | Customer notes / tags | Preferences, service notes and segmentation tags. | Recommended | - | - |
| 9.5 | Marketing consent | Record channel consent and opt-out status. | Recommended | Privacy compliance | - |
| 9.6 | Customer groups | Retail, VIP, wholesale, employee, corporate and similar groups. | Recommended | - | - |
| 9.7 | Customer 360 | Combine orders, spend, returns, loyalty, credit and engagement. | Advanced | Unified data model | High value once CRM/loyalty/omnichannel are mature. |
| 9.8 | Customer segmentation | Dynamic groups based on behavior/value. | Advanced | Analytics/marketing module | - |

## 10. Loyalty, Memberships, Gift Cards & Wallets

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 10.1 | Points earning | Earn points by spend, product or campaign. | Recommended | - | - |
| 10.2 | Points redemption | Redeem points for discount/reward. | Recommended | - | - |
| 10.3 | Points expiry | Configurable expiration and notifications. | Advanced | - | - |
| 10.4 | Tier membership | Silver/Gold/Platinum benefits. | Advanced | - | - |
| 10.5 | Bonus multipliers | Double points by campaign/product/category. | Advanced | - | - |

## 11. Registers, Tills, Cash & Store Operations

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 11.1 | Register open | Open shift/register with starting float. | Essential | - | - |
| 11.2 | Register close | Count and close with expected vs actual totals. | Essential | - | - |
| 11.3 | Cash drawer balance | Maintain theoretical balance throughout shift. | Essential | - | - |
| 11.4 | Paid-in / paid-out | Record controlled non-sale cash movement. | Recommended | - | - |
| 11.5 | Cash pickup / drop | Remove excess cash to safe during shift. | Recommended | - | - |
| 11.6 | End-of-day close | Consolidate registers, tenders and exceptions. | Recommended | - | - |

## 12. Staff, Workforce, Permissions & Approvals

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 12.1 | Individual login / PIN | Tie every action to employee. | Essential | - | - |
| 12.2 | Role-based access | Cashier, supervisor, manager, admin and custom roles. | Essential | - | - |
| 12.3 | Location access | Restrict employee to assigned stores/regions. | Recommended | - | - |
| 12.4 | Function permissions | Discount, refund, void, price override, reports, inventory and other permissions. | Essential | - | - |
| 12.5 | Approval required state | Allow, deny or require manager approval for sensitive action. | Recommended | - | - |
| 12.6 | Approval thresholds | Rules by amount/percentage/action. | Advanced | Approval engine | - |
| 12.7 | Clock in/out | Track attendance from POS. | Optional | HR/payroll integration | - |
| 12.8 | Shift scheduling | Plan employee shifts. | Optional | Workforce module | - |
| 12.9 | Break tracking | Record staff breaks. | Optional | - | - |
| 12.10 | Sales performance | Sales, AOV, items/transaction, refunds and discounts. | Recommended | - | - |
| 12.11 | Commissions | Calculate salesperson commission. | Advanced | Commission rules/payroll interface | - |
| 12.12 | Tip distribution | Allocate pooled/individual tips. | Optional | Hospitality rules | - |

## 13. Reporting, Analytics & BI

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 13.1 | Cash reconciliation report | Expected/actual cash and variance. | Recommended | - | - |
| 13.2 | Custom date ranges / filters | Flexible period, location and dimension filters. | Essential | - | - |
| 13.3 | Scheduled reports | Email/export reports on schedule. | Advanced | Job/notification service | - |
| 13.4 | Custom report builder | User-selected dimensions/measures. | Advanced | Analytics semantic layer | Powerful but development-heavy; defer until standard reports stabilize. |
| 13.5 | Data export | CSV/Excel/PDF exports with permission. | Recommended | - | - |

## 14. Dashboards, Alerts & Exception Management

| Ref | Feature | Description | Priority | Dependencies | Notes |
|---|---|---|---|---|---|
| 14.1 | Owner dashboard | KPIs for sales, margin, transactions and stores. | Recommended | - | - |
| 14.2 | Store manager dashboard | Today sales, tills, staff, stock and exceptions. | Recommended | - | - |
| 14.3 | Low/out-of-stock alerts | Notify inventory exceptions. | Recommended | - | - |
| 14.4 | Cash variance alert | Notify significant over/short. | Recommended | - | - |
| 14.5 | Refund/void alert | Notify unusual or threshold-breaching activity. | Advanced | - | - |
| 14.6 | Failed payment/sync alert | Surface operational failures. | Recommended | - | - |
| 14.7 | Overdue PO/transfer alert | Supply-chain exception reminders. | Advanced | - | - |
| 14.8 | Expiry alert | Warn about upcoming product expiry. | Advanced | Expiry inventory | - |
| 14.9 | Register not closed alert | Notify missing end-of-day closure. | Recommended | - | - |
| 14.10 | Severity / routing | Information, warning and critical alerts routed to role/location. | Advanced | - | - |
| 14.11 | Acknowledgement / resolution | Assign, acknowledge and close exceptions. | Advanced | Workflow engine | - |

## Scope interpretation

This document is the approved feature scope from the attached PDF. It is not an implementation claim or a record of current completion. Current implementation status is tracked separately from this list and must be verified against the POS source code and tests.
