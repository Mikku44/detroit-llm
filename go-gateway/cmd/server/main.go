package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"detroit-llm/go-gateway/internal/admin"
	"detroit-llm/go-gateway/internal/chat"
	"detroit-llm/go-gateway/internal/config"
	convpkg "detroit-llm/go-gateway/internal/conversations"
	"detroit-llm/go-gateway/internal/proxy"
	"detroit-llm/go-gateway/internal/ratelimit"
)

func main() {
	cfg := config.Load()
	limiter := ratelimit.New(cfg.RateLimitPerMinute, time.Minute)
	backendURL := cfg.BackendURL
	sglangURL := cfg.SGLangURL

	var pool *pgxpool.Pool
	var convPool *pgxpool.Pool
	if cfg.DatabaseURL != "" && cfg.JWTSecret != "" {
		pgURL := toPGXURL(cfg.DatabaseURL)
		if p, err := pgxpool.New(context.Background(), pgURL); err == nil {
			pool = p
			defer pool.Close()
			log.Printf("Go admin DB connected")
		} else {
			log.Printf("Go admin DB skip: %v", err)
		}
		if cfg.ConversationsDBURL != "" && cfg.ConversationsDBURL != cfg.DatabaseURL {
			pgURL2 := toPGXURL(cfg.ConversationsDBURL)
			if p2, err := pgxpool.New(context.Background(), pgURL2); err == nil {
				convPool = p2
				defer convPool.Close()
				log.Printf("Go conversations DB connected")
			} else {
				log.Printf("Go conversations DB skip: %v", err)
			}
		} else {
			convPool = pool
		}
	}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(cors(cfg.DashboardURL))

	r.Get("/health", func(w http.ResponseWriter, req *http.Request) {
		sglangOK := false
		client := &http.Client{Timeout: 3 * time.Second}
		if resp, err := client.Get(sglangURL + "/health"); err == nil {
			sglangOK = resp.StatusCode == 200
			resp.Body.Close()
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "sglang": sglangOK})
	})

	r.Get("/", func(w http.ResponseWriter, req *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"name": "Detroit LLM Gateway (Go Edge)",
			"version": "0.1.0-go",
			"backend": backendURL,
			"endpoints": map[string]string{
				"chat": "POST /v1/chat/completions",
				"models": "GET /v1/models",
				"health": "/health",
			},
		})
	})

	// Rate-limited edge for /v1/*
	r.Group(func(gr chi.Router) {
		gr.Use(rateLimitMiddleware(limiter))
		gr.Get("/v1/models", modelsHandler(backendURL))
		if pool != nil {
			gr.Post("/v1/chat/completions", chat.HandleChatCompletions(cfg, pool))
		} else {
			gr.HandleFunc("/v1/chat/completions", chatProxyHandler(backendURL))
		}
		gr.HandleFunc("/v1/responses", genericProxy(backendURL))
		gr.HandleFunc("/v1/messages", genericProxy(backendURL))
		gr.HandleFunc("/v1/*", genericProxy(backendURL))
	})

	// Admin read path migrated to Go (with fallback)
	if pool != nil {
		r.Get("/admin/status", admin.StatusHandler(cfg, pool))
		r.Get("/admin/balances", admin.BalancesHandler(cfg, pool))
		r.Get("/admin/usage", admin.UsageHandler(cfg, pool))
		r.Get("/admin/usage/*", admin.UsageHandler(cfg, pool))
	}
	// Conversations migrated to Go (pg-only, fallback on decrypt fail or sqlite)
	if convPool != nil {
		r.Get("/api/conversations", convpkg.ListHandler(cfg, pool, convPool))
		r.Get("/api/conversations/{conversation_id}", convpkg.GetHandler(cfg, pool, convPool))
		r.Get("/api/conversations/{conversation_id}/messages", convpkg.GetHandler(cfg, pool, convPool))
		r.Delete("/api/conversations/{conversation_id}", convpkg.DeleteHandler(cfg, pool, convPool))
		r.Delete("/api/conversations/{id}", convpkg.DeleteHandler(cfg, pool, convPool))
	}
	// Ensure mutating conversation routes always reach Python when Go has no handler
	r.Post("/api/conversations", func(w http.ResponseWriter, req *http.Request) { forwardToBackend(w, req, backendURL) })
	r.Post("/api/conversations/{conversation_id}/messages", func(w http.ResponseWriter, req *http.Request) { forwardToBackend(w, req, backendURL) })
	r.Put("/api/conversations/{conversation_id}", func(w http.ResponseWriter, req *http.Request) { forwardToBackend(w, req, backendURL) })

	// Fallback everything else to Python backend
	r.HandleFunc("/*", func(w http.ResponseWriter, req *http.Request) {
		forwardToBackend(w, req, backendURL)
	})

	log.Printf("Go edge gateway listening on :%s backend=%s sglang=%s", cfg.Port, backendURL, sglangURL)
	if err := http.ListenAndServe(":"+cfg.Port, r); err != nil {
		log.Fatal(err)
	}
}

func cors(dashboardURL string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allow := dashboardURL
			if origin == "http://localhost:5173" || origin == "http://localhost:5174" || origin == dashboardURL {
				allow = origin
			}
			w.Header().Set("Access-Control-Allow-Origin", allow)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "*")
			w.Header().Set("Access-Control-Allow-Headers", "*")
			if r.Method == http.MethodOptions {
				w.WriteHeader(204)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func rateLimitMiddleware(limiter *ratelimit.Limiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := ""
			if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
				token = strings.TrimPrefix(h, "Bearer ")
			} else {
				token = r.Header.Get("x-api-key")
			}
			key := ratelimit.BucketKey(token)
			if key == "" {
				key = "ip:" + r.RemoteAddr
			}
			ok, retry := limiter.Allow(key)
			if !ok {
				w.Header().Set("Retry-After", strings.TrimSpace(strings.Repeat("", 0)))
				_ = retry
				w.Header().Set("Retry-After", fmt.Sprintf("%d", retry))
				http.Error(w, `{"detail":"Rate limit exceeded. Try again later."}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func modelsHandler(backendURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Cache per free_user key is handled in Python; here cache raw backend response 5m
		auth := r.Header.Get("Authorization")
		cacheKey := "models:all:" + auth
		if data, ok := proxy.CachedModels(cacheKey); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Write(data)
			return
		}
		u, _ := url.Parse(backendURL)
		p := httputil.NewSingleHostReverseProxy(u)
		// Capture response for caching
		rec := &captureWriter{ResponseWriter: w, body: &bytes.Buffer{}, status: 200, header: make(http.Header)}
		p.ServeHTTP(rec, r)
		if rec.status == 200 {
			proxy.SetCachedModels(cacheKey, rec.body.Bytes())
		}
		for k, v := range rec.header {
			for _, vv := range v {
				w.Header().Add(k, vv)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(rec.status)
		io.Copy(w, rec.body)
	}
}

func chatProxyHandler(backendURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		forwardToBackend(w, r, backendURL)
	}
}

func genericProxy(backendURL string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		forwardToBackend(w, r, backendURL)
	}
}

func forwardToBackend(w http.ResponseWriter, r *http.Request, backendURL string) {
	u, _ := url.Parse(backendURL)
	p := httputil.NewSingleHostReverseProxy(u)
	p.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, err error) {
		http.Error(rw, `{"detail":"backend unavailable, fallback"}`, http.StatusBadGateway)
	}
	p.ServeHTTP(w, r)
}

func toPGXURL(u string) string {
	// asyncpg URL: postgresql+asyncpg:// -> postgresql://
	if strings.HasPrefix(u, "postgresql+asyncpg://") {
		return "postgresql://" + strings.TrimPrefix(u, "postgresql+asyncpg://")
	}
	return u
}

type captureWriter struct {
	http.ResponseWriter
	body   *bytes.Buffer
	status int
	header http.Header
}

func (c *captureWriter) Header() http.Header { return c.header }
func (c *captureWriter) WriteHeader(s int)   { c.status = s }
func (c *captureWriter) Write(b []byte) (int, error) { return c.body.Write(b) }
