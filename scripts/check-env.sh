#!/bin/bash
# Prints 1 when .env.local sets NAME to a non-empty value, otherwise 0; never a value.
#   bun run env:check RESEND_API_KEY
# Claude Code may not read .env.local itself (deny rule), so it asks this instead.

name="$1"
if [[ ! "$name" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  echo "usage: bun run env:check NAME" >&2
  exit 2
fi
cd "$(dirname "$0")/.." || exit 2
if [ -f .env.local ] && grep -q "^${name}=." .env.local; then echo 1; else echo 0; fi
