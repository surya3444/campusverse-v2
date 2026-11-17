// Public API of owner-defined fields (decision 0020). Owners manage definitions; the module that
// owns a record saves its values inside its own command, after its own permission check.
export {
  FIELD_DEFINED,
  FieldError,
  defineField,
  listFields,
  orderFields,
  retireField,
  saveValues,
  updateField,
  valuesOf,
  type Field,
  type FieldInput,
} from './application/fields.js';
export {
  FIELD_ENTITIES,
  FIELD_TYPES,
  MAX_ACTIVE_FIELDS,
  type FieldEntity,
  type FieldType,
  type FieldValue,
  type ValueError,
} from './domain/values.js';
