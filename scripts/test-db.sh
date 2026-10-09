#!/usr/bin/env bash
# Throwaway Postgres for tests: in memory (tmpfs), no fsync. Data is disposable by design.
set -e
if docker ps -a --format '{{.Names}}' | grep -qx etm-test-pg; then docker start etm-test-pg >/dev/null; else
  MSYS_NO_PATHCONV=1 docker run -d --name etm-test-pg --restart unless-stopped -p 5545:5432 \
    -e POSTGRES_HOST_AUTH_METHOD=trust --tmpfs /var/lib/postgresql:rw postgres:18 \
    -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200 >/dev/null
fi
echo "test db: postgres://postgres@localhost:5545"
