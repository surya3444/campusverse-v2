---
name: rule-pack
description: Add a board or state rule pack to packages/rules with its source, effective dates and sample tests.
---

1. Identify the authority (board or state), the rule and the official source document. No source means mark it unverified and ask.
2. Create a versioned pack with `source`, `effectiveFrom`, `effectiveTo` and the rule data. Data over code.
3. Write sample tests from worked examples in the source, including boundary edge cases.
4. Modules consume the pack through its interface. Never branch on state or board names in modules.
5. Record the source and verification status in the pack README.
