---
name: ui-screen
description: Build a Campus Verse screen from the design rules and verify it visually.
---

1. Read the UI system section of docs/BUILD_GUIDE.md and .claude/rules/frontend.md.
2. Name the one main task of the screen. Design around it, not around cards.
3. Use packages/ui components and tokens. Bulk actions use the Preview Canvas.
4. Build every state: loading, empty, error, offline, permission denied.
5. All text from language files. Check a regional script (Kannada or Hindi) for overflow.
6. Run axe and a keyboard-only pass. Check contrast of every cyan use.
7. Screenshot desktop and a 360px phone width, and show them.
