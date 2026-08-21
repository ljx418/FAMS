---
name: fams-screenshot-ledger-import
description: Extract FAMS holdings, trades, or external order observations from an attached broker screenshot through a preview-and-confirm ledger workflow.
---

# FAMS Screenshot Ledger Import

Work only from information visibly present in the supplied screenshot. Do not infer hidden quantities, prices, dates, symbols, or order status.

## Workflow

1. Call `capture.upload_screenshot` to private-save the actual PNG, JPEG, or WebP bytes.
2. Extract rows as `holding`, `trade`, or `order`, using the field names in `capture.apply_extraction`. Include per-field confidence and an overall confidence from 0 to 1.
3. Call `capture.apply_extraction`, then `capture.get_preview`. Show low-confidence, missing-field, unmatched-asset, duplicate, and before/after differences clearly.
4. When the user corrects or rejects a row, call `capture.update_row` with `correctedBy`; fetch the new preview and verify that validation and asset matching ran again.
5. Stop at preview until the user explicitly confirms the rows. Confirmation must identify the human and invoke `capture.confirm_rows` only for the approved row IDs.

Holdings absent from the screenshot are a difference warning only. Never close, reduce, or delete them. `order` rows become external-order observations for grid conflict checks; they are not new broker orders. Do not use `create_transaction` as a shortcut around capture confirmation.

If the FAMS ChatBox vision endpoint is used instead of Codex's attached-image understanding, obtain explicit consent for that single upload before the image is sent to the configured vision model.
