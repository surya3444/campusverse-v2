---
paths:
  - 'modules/**'
---

# Module rules

- A module owns its tables. Others never read or write them.
- Import another module only through its contract.ts.
- domain/ has no NestJS, database or HTTP imports.
- school, college and university never import each other.
- Shared modules know nothing about classes or semesters; they ask AcademicPlacementPort.
- Rule logic comes from packages/rules, never `if (state === ...)`.
- Each write use case: set tenant, can(), validate, write, audit row, outbox event — one transaction.
- Names: tables `module_entity`, permissions `module.resource.action`, events `domain.entity.verb.v1`.
- Keep the module README (purpose, owned tables, events) current.
