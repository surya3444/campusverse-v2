# shared/assets

Assets and inventory (docs/specs/ASSETS.md): the dead-stock register and consumable stock. Custodians from people/records.

| Use case                                                | What                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `assetSetup`, `saveNamed`, `installAssetCategories`     | Organisation-wide categories (seven defaults) and per-school locations                                     |
| `assets`, `asset`, `suggestTag`, `findCustodians`       | The register, searchable and filtered; one asset with its history; the next free tag; staff to hold things |
| `addAsset`, `updateAsset`, `disposeAsset`               | Tags unique per school; moves, custodian and condition each a history line; disposed stays on record       |
| `stock`, `stockMovements`, `saveStockItem`, `moveStock` | Receive and issue against the balance (never below zero), low at or under the reorder level                |
| `assetFigures`, `assetTools`                            | Figures and Verse AI `assets.summary`                                                                      |

**Owns:** `asset_category`, `asset_location`, `asset_item`, `asset_event` (append-only), `stock_item`, `stock_movement` (append-only). **Events:** `assets.item.condition_changed.v1`, `assets.stock.low.v1`.

**Not yet:** spreadsheet import, QR labels, physical verification, maintenance and repair requests, depreciation, low-stock messages, purchase requests.
