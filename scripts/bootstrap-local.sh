#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_URL="${DATABASE_URL:-postgresql://branchline:branchline@localhost:5432/branchline}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

is_port_busy() {
  local port="$1"
  local lsof_found=1

  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    lsof_found=0
  fi

  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :$port )" | tail -n +2 | grep -q .; then
      return 0
    fi
  fi

  if [ "$lsof_found" -eq 0 ]; then
    return 1
  fi

  return 1
}

wait_for_port() {
  local port="$1"
  local retries="${2:-30}"
  local count=0
  while ! is_port_busy "$port"; do
    count=$((count + 1))
    if [ "$count" -ge "$retries" ]; then
      return 1
    fi
    sleep 1
  done
}

services_to_start=()
if is_port_busy 5432; then
  printf '[bootstrap] port 5432 already in use; assuming postgres is available.\n'
else
  services_to_start+=("postgres")
fi

if is_port_busy 6379; then
  printf '[bootstrap] port 6379 already in use; assuming redis is available.\n'
else
  services_to_start+=("redis")
fi

if [ "${#services_to_start[@]}" -gt 0 ]; then
  printf '[bootstrap] starting local services: %s\n' "${services_to_start[*]}"
  docker compose -f infra/docker/docker-compose.yml up -d "${services_to_start[@]}"
fi

wait_for_port 5432 45 || {
  printf '[bootstrap] postgres is not reachable on port 5432.\n' >&2
  exit 1
}

wait_for_port 6379 45 || {
  printf '[bootstrap] redis is not reachable on port 6379.\n' >&2
  exit 1
}

printf '[bootstrap] installing dependencies...\n'
pnpm install

printf '[bootstrap] generating prisma client...\n'
pnpm --filter @branchline/api-server prisma:generate

printf '[bootstrap] applying migrations...\n'
pnpm --filter @branchline/api-server exec prisma migrate deploy

printf '[bootstrap] ready. DATABASE_URL=%s REDIS_URL=%s\n' "$DATABASE_URL" "$REDIS_URL"
