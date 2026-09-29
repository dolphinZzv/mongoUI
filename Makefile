SHELL := /bin/bash

BIN     ?= bin/mongoui
ADDR    ?= :8080
DATA    ?= data
MONGO   ?= mongodb://127.0.0.1:27017
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.PHONY: help install build frontend backend gen run dev dev-backend dev-frontend test fmt vet tidy clean docker-mongo sync-version

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install front-end dependencies
	cd frontend && npm install

frontend: ## Build the front-end and stage it for embedding
	cd frontend && VITE_APP_VERSION=$(VERSION) npm run build
	find backend/web/dist -mindepth 1 ! -name .gitkeep -delete
	cp -r frontend/dist/. backend/web/dist/
	./scripts/gzip-assets.sh backend/web/dist

backend: frontend ## Compile the Go server (always embeds a fresh front-end)
	@mkdir -p bin
	cd backend && go build -ldflags "-X main.version=$(VERSION)" -o ../$(BIN) .

sync-version: ## Sync frontend/package.json version to the current git tag
	./scripts/sync-version.sh

build: ## Build everything into a single self-contained binary (scripts/build.sh)
	./scripts/build.sh

gen: ## Rebuild the front-end into backend/web/dist via go:generate
	cd backend && go generate ./...

run: build ## Build then run the production server
	./$(BIN) -addr $(ADDR) -data $(DATA)

dev: ## Run backend + Vite dev server together (scripts/dev.sh)
	./scripts/dev.sh

dev-backend: ## Run the API with live reload disabled (Vite proxies /api here)
	cd backend && go run . -addr :8080 -data ../$(DATA)

dev-frontend: ## Run the Vite dev server
	cd frontend && npm run dev

test: ## Run Go tests
	cd backend && go test ./...

fmt: ## Format Go sources
	cd backend && gofmt -w .

vet: ## Run go vet
	cd backend && go vet ./...

tidy: ## Tidy Go modules
	cd backend && go mod tidy

clean: ## Remove build artifacts
	rm -rf bin frontend/dist data
	find backend/web/dist -mindepth 1 ! -name .gitkeep -delete

docker-mongo: ## Start a disposable MongoDB for local development
	docker run --rm -d --name mongoui-mongo -p 27017:27017 mongo:8
