# platform/fields

Owner-defined fields (docs/specs/INSTITUTION_DEPTH.md, decision 0020). Owners add their own fields to organisation, campus, institution, admission, staff, student and guardian records without a migration.

| Use case                                                   | What                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listFields`                                               | An entity's fields in form order (active, or with retired)                                                                                                                                                                                                                  |
| `defineField`, `updateField`, `retireField`, `orderFields` | Owners only (`platform.fields.manage`). The key comes from the label and never changes; nor does the type. Retiring hides a field and keeps its values. At most 60 active fields per entity                                                                                 |
| `saveValues`, `valuesOf`                                   | Called by the module that owns the record, inside its own command after its own permission check. Values are checked against the definition (`domain/values.ts`); numbers stay exact decimal strings. Returns changed keys for the caller's audit (keys only, never values) |

**Owns:** `custom_field`, `custom_field_value`. **Events:** `platform.field.defined.v1` (value changes travel in the owning module's event).

**Not yet:** conditional fields (show B when A is yes), per-institution fields, file fields upload from the form (they take a stored file id).
