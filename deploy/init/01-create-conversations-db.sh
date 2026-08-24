#!/bin/bash
set -e

# Ensure the conversations database exists alongside the main one.
# Runs once on first container start (docker-entrypoint-initdb.d).
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE detroit_conversations'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'detroit_conversations')\gexec
EOSQL
