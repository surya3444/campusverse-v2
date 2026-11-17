# Assets and inventory: spec

Status: **step 1 built** (11 November 2026); step 2 when schools ask. From the platform map (Operations → Assets and inventory: "assets, stock and maintenance") and what schools keep on paper: a dead-stock register for furniture and equipment, and a stock register for consumables (chalk, paper, cleaning material). Anything marked _Default_ stands unless the owner changes it.

## Job

The school knows every asset it owns: its tag, where it is, who looks after it, its condition, what it cost and when its warranty ends, with a history of every move. A broken projector is marked, a written-off bench keeps its record. Consumables are received and issued against a running balance, and the office sees what is running low before it runs out.

## Module

**`modules/shared/assets`**, shared because colleges and universities run the same registers. Custodians are staff found through people/records (`searchMembers`, `memberKind`, `displayNames`).

### Owned tables (all tenant tables: `org_id`, RLS, FORCE RLS)

| Table            | Holds                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset_category` | Organisation-wide: name, active                                                                                                                                                                                                     |
| `asset_location` | Per institution: name (a room, a lab, a store), active                                                                                                                                                                              |
| `asset_item`     | Institution, tag (unique there), name, category, location, custodian (staff, optional), condition (`good`, `needs_repair`, `broken`), purchased on, cost (paise), vendor, serial number, warranty until, notes, disposed on and why |
| `asset_event`    | Append-only history: item, kind (`added`, `moved`, `custodian`, `condition`, `disposed`), from and to, note, by, at                                                                                                                 |
| `stock_item`     | Per institution: name, unit (pieces, boxes, reams, litres), reorder level, active                                                                                                                                                   |
| `stock_movement` | Append-only: item, `in` or `out`, quantity (whole units), note, issued to (a person, optional), by, at                                                                                                                              |

**Rules the database enforces:** tags unique per institution (case-insensitive); costs in whole paise, never negative; history and stock movements never edited or deleted; quantities above zero; a disposed asset has a reason.

**Permissions** (SCHOOL_ROLES, migration, access catalogue, area `assets`):

- `assets.item.read`: owner, school admin, principal, office.
- `assets.item.manage`: the same roles. Add, move, change custodian or condition, dispose; locations and categories.
- `assets.stock.manage`: the same roles. Stock items, receiving and issuing.

**Events:** `assets.item.condition_changed.v1`, `assets.stock.low.v1`.

## Decisions (_Default_, 11 November 2026)

1. **Tags** are what's painted or stuck on the item: up to 20 letters, digits, `/` and `-`. Adding suggests the next after the highest in use (`AST-0001`); a school with a register types its own.
2. **Categories** start as Furniture, IT equipment, Lab equipment, Sports equipment, Electrical, Musical instruments, Other.
3. **Disposing** (written off, sold, given away) needs a reason; the item stays in the register as disposed, out of the counts.
4. **Stock:** receiving adds, issuing takes away; issuing more than the balance is refused. An item at or below its reorder level is **low**; the first time an issue takes it there, `assets.stock.low.v1` is emitted (step 2 messages the office).
5. **Money:** asset costs are recorded for the register, not paid here: purchases go through Expenses.

## Screens

| Screen       | Behaviour                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Assets (web) | Key figures (assets, needing repair or broken, warranties ending in 30 days, stock items low). **Register**: search by tag, name or serial; filter by location, category, condition; **Add asset** (modal). An asset opens in a side panel with its history: move, custodian, condition, dispose |
| Stock        | Items with balance, unit and reorder level, low first; **Add item**, **Receive**, **Issue** (modals); each item's recent movements                                                                                                                                                               |
| Settings     | Locations and categories                                                                                                                                                                                                                                                                         |

## Steps

1. Register with tags, locations, custodians, condition, warranty and history; disposal; consumable stock with receive, issue, balance and low flags; Verse AI `assets.summary` (counts); tests (allowed and refused, end to end).
2. Import the register from a spreadsheet (preview, then commit), printed tag labels with QR codes, annual physical verification, maintenance schedules and repair requests through the helpdesk, depreciation, messages when stock runs low, purchase requests from low stock.
