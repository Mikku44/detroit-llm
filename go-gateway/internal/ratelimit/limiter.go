package ratelimit

import (
	"crypto/sha256"
	"fmt"
	"sync"
	"time"
)

type Limiter struct {
	limit  int
	window time.Duration
	mu     sync.Mutex
	hits   map[string][]time.Time
}

func New(limit int, window time.Duration) *Limiter {
	return &Limiter{limit: limit, window: window, hits: make(map[string][]time.Time)}
}

func BucketKey(token string) string {
	if token == "" {
		return ""
	}
	h := sha256.Sum256([]byte(token))
	return fmt.Sprintf("key:%x", h[:8])
}

func (l *Limiter) Allow(key string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	hits := l.hits[key]
	n := 0
	for _, t := range hits {
		if t.After(cutoff) {
			hits[n] = t
			n++
		}
	}
	hits = hits[:n]
	if len(hits) >= l.limit {
		retry := int(l.window - now.Sub(hits[0])) + 1
		if retry < 1 {
			retry = 1
		}
		l.hits[key] = hits
		return false, retry
	}
	l.hits[key] = append(hits, now)
	return true, 0
}
