COMPOSE := docker compose
COMPOSE_SH := docker compose --profile selfhosted
ENV_FILE  := .env

.PHONY: all build up up-selfhosted down restart logs ps clean health help docker bench bench-py

all: build up

docker: all

build:
	$(COMPOSE) build

build-nc:
	$(COMPOSE) build --no-cache

up:
	@if [ ! -f $(ENV_FILE) ]; then echo "Missing $(ENV_FILE) — copy .env.example to .env first"; exit 1; fi
	$(COMPOSE) up -d
	@$(MAKE) ps

up-selfhosted:
	@if [ ! -f $(ENV_FILE) ]; then echo "Missing $(ENV_FILE) — copy .env.example to .env first"; exit 1; fi
	$(COMPOSE_SH) up -d --build
	@$(MAKE) ps

down:
	$(COMPOSE) down

restart: down up

logs:
	$(COMPOSE) logs -f

logs-backend:
	$(COMPOSE) logs -f backend

logs-go:
	$(COMPOSE) logs -f go-gateway

logs-web:
	$(COMPOSE) logs -f web

ps:
	$(COMPOSE) ps

health:
	@echo "== backend :8000/health ==" && curl -sf http://localhost:8000/health || echo "backend not ready"
	@echo "== go-gateway :8080/health ==" && curl -sf http://localhost:8080/health || echo "go-gateway not ready"
	@echo "== web :80 ==" && curl -sI http://localhost:80 | head -n 1 || true

clean:
	$(COMPOSE) down -v --remove-orphans

bench:
	bash bench/run.sh 50 2000

bench-py:
	pip install -q httpx 2>/dev/null || pip3 install -q httpx
	python bench/bench.py --url http://localhost:8080 --url2 http://localhost:8000 --concurrency 50 --requests 2000

help:
	@echo "Usage: make -C deploy [target]"
	@echo "  all            build + up (default, == docker)"
	@echo "  docker         alias for all"
	@echo "  build          docker compose build (all services: backend, go-gateway, web)"
	@echo "  build-nc       build --no-cache"
	@echo "  up             up -d (needs deploy/.env)"
	@echo "  up-selfhosted  up -d --build with postgres (profile selfhosted)"
	@echo "  down           compose down"
	@echo "  restart        down + up"
	@echo "  logs           logs -f all"
	@echo "  logs-backend   logs -f backend"
	@echo "  logs-go        logs -f go-gateway"
	@echo "  logs-web       logs -f web"
	@echo "  ps             compose ps"
	@echo "  health         curl /health on backend + go-gateway"
	@echo "  bench          hey/wrk bench Go vs Python (needs hey/wrk or fallback to bench-py)"
	@echo "  bench-py       python httpx bench Go vs Python"
	@echo "  clean          down -v --remove-orphans (wipe volumes)"
