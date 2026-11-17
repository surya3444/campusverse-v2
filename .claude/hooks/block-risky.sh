#!/bin/bash
# Blocks Bash commands that mention production or drop a database. A safety net, not the only guard.
command=$(jq -r '.tool_input.command')
if echo "$command" | grep -Eiq '(^|[^a-z])prod([^a-z]|$)|production|DROP[[:space:]]+DATABASE'; then
  echo "Blocked: production or destructive command. A human must run this." >&2
  exit 2
fi
exit 0
