package chat

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"detroit-llm/go-gateway/internal/config"
)

var (
	usageCache = struct {
		sync.RWMutex
		m map[string]cachedUsage
	}{m: make(map[string]cachedUsage)}
	usageTTL = 45 * time.Second
)

type cachedUsage struct {
	weekly  int64
	monthly int64
	ts      time.Time
}

var imageOnlyModels = map[string]bool{
	"z-image-turbo": true, "gpt-image-1": true, "dall-e-3": true, "gemini-2.0-flash-preview-image-generation": true, "glm-image": true, "cogview-4": true, "cogview-4-250304": true,
	"grok-imagine-image": true, "grok-imagine-image-quality": true, "grok-2-image": true, "grok-image": true, "grok-imagine": true,
}

func isImageModel(model string) bool {
	return imageOnlyModels[strings.ToLower(model)]
}

func HandleChatCompletions(cfg config.Config, pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		var req struct {
			Model  string `json:"model"`
			Stream *bool  `json:"stream"`
		}
		_ = json.Unmarshal(body, &req)
		model := strings.ToLower(req.Model)
		if isImageModel(model) {
			body = ensureImageGen(body)
			r.Body = io.NopCloser(bytes.NewReader(body))
			forwardToBackend(w, r, cfg.BackendURL)
			return
		}
		isDirect := strings.Contains(model, "deepseek") || strings.HasPrefix(model, "glm-") || strings.HasPrefix(model, "grok") || model == ""
		if !isDirect {
			forwardToBackend(w, r, cfg.BackendURL)
			return
		}
		// Auth
		rawKey := extractKey(r)
		if rawKey == "" {
			http.Error(w, `{"detail":"Missing or invalid Authorization header"}`, 401)
			return
		}
		userID, err := resolveUserID(r.Context(), pool, rawKey)
		if err != nil {
			http.Error(w, `{"detail":"Invalid or revoked API key"}`, 401)
			return
		}
		// Tier check (reuse Python logic simplified)
		if err := checkTier(r.Context(), pool, userID); err != nil {
			http.Error(w, fmt.Sprintf(`{"detail":%q}`, err.Error()), 403)
			return
		}
		// Choose upstream
		upstreamURL, upstreamKey := pickUpstream(model, cfg)
		if upstreamKey == "" {
			forwardToBackend(w, r, cfg.BackendURL)
			return
		}
		// Rebuild request to upstream
		upReq, _ := http.NewRequestWithContext(r.Context(), "POST", upstreamURL+"/chat/completions", bytes.NewReader(body))
		upReq.Header.Set("Content-Type", "application/json")
		upReq.Header.Set("Authorization", "Bearer "+upstreamKey)
		client := &http.Client{Timeout: 300 * time.Second}
		resp, err := client.Do(upReq)
		if err != nil {
			http.Error(w, `{"detail":"upstream unavailable"}`, 502)
			return
		}
		defer resp.Body.Close()
		// Log usage async (best-effort)
		go logUsage(pool, userID, req.Model, body, resp)

		// Stream passthrough
		for k, v := range resp.Header {
			for _, vv := range v {
				w.Header().Add(k, vv)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}
}

func extractKey(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.Header.Get("x-api-key")
}

func prefixOf(key string) string {
	if !strings.HasPrefix(key, "sk-dt-") {
		return ""
	}
	parts := strings.Split(key, "-")
	if len(parts) < 4 {
		return ""
	}
	return strings.Join(parts[:3], "-")
}

func resolveUserID(ctx context.Context, pool *pgxpool.Pool, rawKey string) (string, error) {
	prefix := prefixOf(rawKey)
	if prefix == "" {
		return "", fmt.Errorf("bad prefix")
	}
	var userID, hash string
	err := pool.QueryRow(ctx, `SELECT user_id, key_hash FROM api_keys WHERE key_prefix=$1 AND is_active=true LIMIT 1`, prefix).Scan(&userID, &hash)
	if err != nil {
		return "", err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(rawKey)); err != nil {
		// fallback sha256 if stored differently
		h := sha256.Sum256([]byte(rawKey))
		if fmt.Sprintf("%x", h[:]) != hash {
			return "", fmt.Errorf("hash mismatch")
		}
	}
	// touch async
	go func() {
		ctx2, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		pool.Exec(ctx2, `UPDATE api_keys SET last_used_at=NOW() WHERE key_prefix=$1`, prefix)
	}()
	return userID, nil
}

func checkTier(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	// Load user tier
	var tierID string
	var isMember, isOwner, isPaid bool
	err := pool.QueryRow(ctx, `SELECT tier_id, is_member, is_owner, is_paid FROM users WHERE id=$1`, userID).Scan(&tierID, &isMember, &isOwner, &isPaid)
	if err != nil {
		return fmt.Errorf("Membership required")
	}
	tierLimits := map[string][2]int64{
		"nomad": {500000, 2170000},
		"nomad_extra_claude": {90000, 360000},
		"dreamer": {1000000, 4350000},
		"dreamer_extra_claude": {32000, 128000},
		"entrepreneur": {3000000, 13040000},
		"angel": {10000000, 43450000},
	}
	if lim, ok := tierLimits[tierID]; ok && tierID != "free" && tierID != "" {
		w, m := getUsage(ctx, pool, userID)
		if w >= lim[0] {
			return fmt.Errorf("Weekly limit reached. Upgrade to a higher tier or wait for the weekly window to reset.")
		}
		if m >= lim[1] {
			return fmt.Errorf("Monthly limit reached. Upgrade to a higher tier or wait for the monthly window to reset.")
		}
		return nil
	}
	if isMember || isOwner || isPaid {
		return nil
	}
	w, m := getUsage(ctx, pool, userID)
	if w >= 100000 {
		return fmt.Errorf("Weekly limit reached. Upgrade to a paid membership for more usage.")
	}
	if m >= 435000 {
		return fmt.Errorf("Monthly limit reached. Upgrade to a paid membership for more usage.")
	}
	return nil
}

func getUsage(ctx context.Context, pool *pgxpool.Pool, userID string) (int64, int64) {
	usageCache.RLock()
	if c, ok := usageCache.m[userID]; ok && time.Since(c.ts) < usageTTL {
		usageCache.RUnlock()
		return c.weekly, c.monthly
	}
	usageCache.RUnlock()
	now := time.Now()
	weekCut := now.AddDate(0, 0, -7)
	monthCut := now.AddDate(0, 0, -30)
	var w, mo int64
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ul.total_tokens),0) FROM usage_logs ul
		JOIN api_keys ak ON ul.api_key_id=ak.id
		WHERE ak.user_id=$1 AND ul.created_at >= $2`, userID, weekCut).Scan(&w)
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(ul.total_tokens),0) FROM usage_logs ul
		JOIN api_keys ak ON ul.api_key_id=ak.id
		WHERE ak.user_id=$1 AND ul.created_at >= $2`, userID, monthCut).Scan(&mo)
	usageCache.Lock()
	usageCache.m[userID] = cachedUsage{weekly: w, monthly: mo, ts: time.Now()}
	usageCache.Unlock()
	return w, mo
}

func pickUpstream(model string, cfg config.Config) (string, string) {
	low := strings.ToLower(model)
	if strings.HasPrefix(low, "glm-") {
		if cfg.ZAIKey != "" {
			return strings.TrimSuffix(cfg.ZAIURL, "/"), cfg.ZAIKey
		}
		return "", ""
	}
	if strings.HasPrefix(low, "grok") {
		if cfg.GrokAPIKey != "" {
			return strings.TrimSuffix(cfg.GrokAPIURL, "/"), cfg.GrokAPIKey
		}
		return "", ""
	}
	if cfg.DeepseekKey != "" {
		return strings.TrimSuffix(cfg.DeepseekURL, "/"), cfg.DeepseekKey
	}
	return "", ""
}

func logUsage(pool *pgxpool.Pool, userID, model string, reqBody []byte, resp *http.Response) {
	// Best-effort: read api_key id and insert 0 tokens if stream (usage unknown)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var akID string
	err := pool.QueryRow(ctx, `SELECT id FROM api_keys WHERE user_id=$1 AND is_active=true LIMIT 1`, userID).Scan(&akID)
	if err != nil || akID == "" {
		return
	}
	// Invalidate cache
	usageCache.Lock()
	delete(usageCache.m, userID)
	usageCache.Unlock()
	_, _ = pool.Exec(ctx, `INSERT INTO usage_logs (id, api_key_id, model, prompt_tokens, completion_tokens, total_tokens, created_at) VALUES (gen_random_uuid(), $1, $2, 0, 0, 0, NOW())`, akID, model)
}

func ensureImageGen(body []byte) []byte {
	var m map[string]interface{}
	if err := json.Unmarshal(body, &m); err != nil {
		return body
	}
	if _, ok := m["image_gen"]; !ok {
		m["image_gen"] = true
		if nb, err := json.Marshal(m); err == nil {
			return nb
		}
	}
	return body
}

func HandleWebChatCompletions(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		body, _ := io.ReadAll(r.Body)
		r.Body = io.NopCloser(bytes.NewReader(body))
		var req struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(body, &req)
		if isImageModel(req.Model) {
			body = ensureImageGen(body)
			r.Body = io.NopCloser(bytes.NewReader(body))
		}
		forwardToBackend(w, r, cfg.BackendURL)
	}
}

func forwardToBackend(w http.ResponseWriter, r *http.Request, backendURL string) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(body))
	client := &http.Client{Timeout: 300 * time.Second}
	req, _ := http.NewRequestWithContext(r.Context(), r.Method, backendURL+r.URL.RequestURI(), bytes.NewReader(body))
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
	io.Copy(w, resp.Body)
}
