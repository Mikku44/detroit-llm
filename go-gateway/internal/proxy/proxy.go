package proxy

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

type CacheEntry struct {
	Data []byte
	TS   time.Time
}

var (
	modelsCache   map[string]CacheEntry = make(map[string]CacheEntry)
	modelsMu      sync.RWMutex
	modelsTTL     = 5 * time.Minute
)

func CachedModels(key string) ([]byte, bool) {
	modelsMu.RLock()
	e, ok := modelsCache[key]
	modelsMu.RUnlock()
	if !ok || time.Since(e.TS) > modelsTTL {
		return nil, false
	}
	return e.Data, true
}

func SetCachedModels(key string, data []byte) {
	cp := make([]byte, len(data))
	copy(cp, data)
	modelsMu.Lock()
	modelsCache[key] = CacheEntry{Data: cp, TS: time.Now()}
	modelsMu.Unlock()
}

func ReverseProxy(target string) *httputil.ReverseProxy {
	u, _ := url.Parse(target)
	p := httputil.NewSingleHostReverseProxy(u)
	p.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, `{"detail":"upstream unavailable"}`, http.StatusBadGateway)
	}
	return p
}

func ProxyWithFallback(w http.ResponseWriter, r *http.Request, primary, fallback string) {
	backend := primary
	if shouldFallback(r) {
		backend = fallback
	}
	// Try primary first; on 5xx fallback to secondary
	rec := &responseRecorder{ResponseWriter: w, status: 200, body: &bytes.Buffer{}}
	p := ReverseProxy(backend)
	p.ServeHTTP(rec, r)
	if rec.status >= 500 && backend == primary && fallback != "" {
		// retry to fallback
		fb := ReverseProxy(fallback)
		// need to re-read body - assume GET or small POST; for streaming we don't double-buffer
		fb.ServeHTTP(w, r)
		return
	}
	// copy recorded response to real writer
	for k, v := range rec.Header() {
		for _, vv := range v {
			w.Header().Add(k, vv)
		}
	}
	w.WriteHeader(rec.status)
	io.Copy(w, rec.body)
}

func shouldFallback(r *http.Request) bool {
	return r.Header.Get("X-Force-Fallback") == "1"
}

type responseRecorder struct {
	http.ResponseWriter
	status int
	body   *bytes.Buffer
	header http.Header
}

func (r *responseRecorder) Header() http.Header {
	if r.header == nil {
		r.header = make(http.Header)
	}
	return r.header
}

func (r *responseRecorder) WriteHeader(s int) { r.status = s }
func (r *responseRecorder) Write(b []byte) (int, error) { return r.body.Write(b) }

func IsStreamingRequest(r *http.Request) bool {
	// For POST /v1/chat/completions with stream:true
	if r.Method != http.MethodPost {
		return false
	}
	ct := r.Header.Get("Content-Type")
	return strings.Contains(ct, "application/json")
}
