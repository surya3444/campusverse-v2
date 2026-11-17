---
name: product-vision
description: "Owner's product vision: end-to-end campus ERP organised like campx.in into six systems, org admin all-powerful, forms in modals"
metadata:
  node_type: memory
  type: user
  originSessionId: 0a108611-eadb-4365-97df-d741588b2bd8
  modified: 2026-11-08T13:11:26.968Z
---

The owner wants Campus Verse to be an end-to-end, enterprise-grade campus ERP (benchmark: campx.in, etlab), for schools, colleges and universities, but building for schools first.

- Information architecture follows campx.in's six systems: Academics, Finance, Operations, Enrollment, People, AI (ours: Verse AI). Every feature is classified under one of them and the systems are connected (one record, shared data).
- Hierarchy is organisation → campuses → institutions. The organisation admin (owner) is the super power: can see and do everything across every campus and institution.
- Forms open in modals (dialogs), never as inline panels that push existing content around.
- Expects polished, no-mistakes output; explores visually and judges by the real screens.

**How to apply:** place new modules under one of the six systems in nav and docs/PLATFORM_MAP.md; build create/edit forms with the shared FormModal; always consider the org-wide (all campuses) view for the owner. See [[design-direction]].
