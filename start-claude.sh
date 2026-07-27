#!/usr/bin/env bash
# Loads .env variables into the shell, then launches Claude Code.
# Usage: ./start-claude.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Copy .env.example to .env and fill in your values."
  exit 1
fi

# Export all non-comment, non-empty lines from .env
set -a
source "$ENV_FILE"
set +a

exec claude "$@"