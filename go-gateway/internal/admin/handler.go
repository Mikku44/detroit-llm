package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"detroit-llm/go-gateway/internal/auth"
	"detroit-llm/go-gateway/internal/config"
)

var (
	statusCache   struct{ data []byte; ts time.Time }
	statusMu      sync.RWMutex
	statusTTL     = 15 * time.Second
)

func StatusHandler(cfg config.Config, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := auth.RequireSession(r.Header.Get("Authorization"), cfg.JWTSecret)
		if err != nil || cfg.JWTSecret == "" {
			fallbackProxy(w, r, cfg)
			return
		}
		if pool == nil {
			fallbackProxy(w, r, cfg)
			return
		}
		if !isOwner(r.Context(), pool, uid) {
			http.Error(w, `{"detail":"Owner access required"}`, 403)
			return
		}
		statusMu.RLock()
		if statusCache.data != nil && time.Since(statusCache.ts) < statusTTL {
			w.Header().Set("Content-Type", "application/json")
			w.Write(statusCache.data)
			statusMu.RUnlock()
			return
		}
		statusMu.RUnlock()

		data, err := buildStatus(r.Context(), pool, cfg)
		if err != nil {
			fallbackProxy(w, r, cfg)
			return
		}
		b, _ := json.Marshal(data)
		statusMu.Lock()
		statusCache = struct{ data []byte; ts time.Time }{data: b, ts: time.Now()}
		statusMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write(b)
	}
}

func BalancesHandler(cfg config.Config, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Balances still needs upstream HTTP calls — delegate to Python for now
		fallbackProxy(w, r, cfg)
	}
}

func UsageHandler(cfg config.Config, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := auth.RequireSession(r.Header.Get("Authorization"), cfg.JWTSecret)
		if err != nil || pool == nil {
			fallbackProxy(w, r, cfg)
			return
		}
		days := 7
		fmt.Sscan(r.URL.Query().Get("days"), &days)
		if days < 1 {
			days = 7
		}
		if days > 365 {
			days = 365
		}
		_ = uid
		// For now delegate heavy aggregation to Python to avoid divergence; Go cache can be added later
		fallbackProxy(w, r, cfg)
	}
}

func isOwner(ctx context.Context, pool *pgxpool.Pool, uid string) bool {
	var isOwner bool
	err := pool.QueryRow(ctx, `SELECT is_owner FROM users WHERE id=$1`, uid).Scan(&isOwner)
	return err == nil && isOwner
}

func buildStatus(ctx context.Context, pool *pgxpool.Pool, cfg config.Config) (map[string]interface{}, error) {
	now := time.Now().UTC()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	weekCut := now.AddDate(0, 0, -7)
	monthCut := now.AddDate(0, 0, -30)

	totals := func(cutoff time.Time) (tokens int64, reqs int64, err error) {
		err = pool.QueryRow(ctx, `SELECT COALESCE(SUM(total_tokens),0), COUNT(*) FROM usage_logs WHERE created_at >= $1`, cutoff).Scan(&tokens, &reqs)
		return
	}
	todayT, todayR, _ := totals(todayStart)
	weekT, weekR, _ := totals(weekCut)
	monthT, monthR, _ := totals(monthCut)

	var totalUsers, owners, activeKeys, totalKeys int64
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&totalUsers)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE is_owner=true`).Scan(&owners)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys`).Scan(&totalKeys)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE is_active=true`).Scan(&activeKeys)

	var paid int64
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE is_member=true OR is_owner=true OR is_paid=true`).Scan(&paid)
	freeUsers := totalUsers - paid

	// free tier sums: join
	var freeWeek, freeMonth int64
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ul.total_tokens),0) FROM usage_logs ul
		JOIN api_keys ak ON ul.api_key_id=ak.id
		JOIN users u ON ak.user_id=u.id
		WHERE u.is_member=false AND u.is_owner=false AND u.is_paid=false AND ul.created_at >= $1`, weekCut).Scan(&freeWeek)
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ul.total_tokens),0) FROM usage_logs ul
		JOIN api_keys ak ON ul.api_key_id=ak.id
		JOIN users u ON ak.user_id=u.id
		WHERE u.is_member=false AND u.is_owner=false AND u.is_paid=false AND ul.created_at >= $1`, monthCut).Scan(&freeMonth)

	sglangOK := false
	client := &http.Client{Timeout: 3 * time.Second}
	if resp, err := client.Get(cfg.SGLangURL + "/health"); err == nil {
		sglangOK = resp.StatusCode == 200
		resp.Body.Close()
	}

	_ = pgx.ErrNoRows // keep import

	return map[string]interface{}{
		"status":  "ok",
		"version": "0.1.0-go",
		"time":    now.Format(time.RFC3339),
		"health": map[string]interface{}{
			"sglang":      sglangOK,
			"members_url": "",
			"providers": map[string]interface{}{
				"deepseek_configured":   cfg.DeepseekKey != "",
				"gemini_configured":     false,
				"zai_configured":        cfg.ZAIKey != "",
				"dashscope_configured":  cfg.DashScopeKey != "",
				"grok_configured":       cfg.GrokAPIKey != "",
				"openrouter_configured": false,
				"image_provider":        cfg.ImageProvider,
				"grok_image_model":      cfg.GrokImageModel,
			},
		},
		"balance": map[string]interface{}{
			"today": map[string]interface{}{"tokens": todayT, "requests": todayR},
			"week":  map[string]interface{}{"tokens": weekT, "requests": weekR},
			"month": map[string]interface{}{"tokens": monthT, "requests": monthR},
			"free_tier": map[string]interface{}{
				"per_user_weekly_limit":  100000,
				"per_user_monthly_limit": 435000,
				"weekly_used":            freeWeek,
				"monthly_used":           freeMonth,
				"free_users":             freeUsers,
			},
		},
		"users": map[string]interface{}{
			"total": totalUsers, "owners": owners, "members": paid - owners, "free": freeUsers,
		},
		"api_keys": map[string]interface{}{"total": totalKeys, "active": activeKeys},
	}, nil
}

func fallbackProxy(w http.ResponseWriter, r *http.Request, cfg config.Config) {
	// reverse proxy to Python backend
	// minimal inline to avoid import cycle
	target := cfg.BackendURL
	if target == "" {
		http.Error(w, `{"detail":"backend not configured"}`, 502)
		return
	}
	// use standard library reverse proxy
	// We create a new request to avoid Go gateway's own headers
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequestWithContext(r.Context(), r.Method, target+r.URL.RequestURI(), r.Body)
	for k, v := range r.Header {
		for _, vv := range v {
			req.Header.Add(k, vv)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, `{"detail":"backend unavailable"}`, 502)
		return
	}
	defer resp.Body.Close()
	for k, v := range resp.Header {
		for _, vv := range v {
			w.Header().Add(k, vv)
		}
	}
	w.WriteHeader(resp.StatusCode)
	b := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(b)
		if n > 0 {
			w.Write(b[:n])
		}
		if err != nil {
			break
		}
	}
}
