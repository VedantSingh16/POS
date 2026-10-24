# Cashier quick card

## Till flow

1. Sign in with the store's shared till login and choose a named cashier. If the store requires it, enter that cashier's PIN.
2. Open the assigned register with the opening float. Register open, cash movements, returns, holds and completed sales all require the current cashier selection.
3. Use `/` or F2 to focus search; fast barcode-wedge input ending in Enter adds an exact barcode match.
4. Use quick keys/category buttons, quantity controls, line notes and line discounts.
5. Press F4 to hold, F12 or Ctrl+Enter to pay, and Del to remove the last line.
6. Select cash, card, UPI or a split tender. Cash accepts a tendered amount and returns change after configured rounding.
7. Before **Complete sale**, check the **Print receipt** switch at the bottom of the payment dialog (the till remembers your last choice). The receipt prints after the server confirms the sale. If it does not come out, press **Reprint** on the "Sale complete" screen; the sale is already saved. Cash sales saved while offline print from Sales once they sync. If the till says **Receipt printer not set up on this till**, press **Set up** once and follow the steps; a receipt that comes out small in the middle of a big page, or with a date and web address on it, means the printer setup is wrong.
8. Change the cashier from the header chip at any time. Stores can require a fresh selection for every bill; an idle lock can also clear the selection.
9. If a discount requires approval, enter the manager PIN in the approval panel.
10. At close, count by denomination where possible and record paid-in, paid-out, drop or pickup movements with a reason.

All amounts are stored in paise and recalculated by the server at checkout. Never rely on the displayed client total as the accounting record.
