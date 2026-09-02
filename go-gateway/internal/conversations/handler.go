package conversations

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"detroit-llm/go-gateway/internal/auth"
	"detroit-llm/go-gateway/internal/config"
)

func ListHandler(cfg config.Config, pool *pgxpool.Pool, convPool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := auth.RequireSession(r.Header.Get("Authorization"), cfg.JWTSecret)
		if err != nil || pool == nil || convPool == nil {
			fallback(w, r, cfg)
			return
		}
		if isSQLite(cfg.ConversationsDBURL) {
			fallback(w, r, cfg)
			return
		}
		limit := 50
		offset := 0
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, e := strconv.Atoi(v); e == nil {
				if n < 1 {
					n = 1
				}
				if n > 100 {
					n = 100
				}
				limit = n
			}
		}
		if v := r.URL.Query().Get("offset"); v != "" {
			if n, e := strconv.Atoi(v); e == nil && n >= 0 {
				offset = n
			}
		}
		ctx := r.Context()
		var total int64
		_ = convPool.QueryRow(ctx, `SELECT COUNT(*) FROM conversations WHERE user_id=$1`, uid).Scan(&total)
		rows, err := convPool.Query(ctx, `SELECT id, title, model, created_at, updated_at FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`, uid, limit, offset)
		if err != nil {
			fallback(w, r, cfg)
			return
		}
		defer rows.Close()
		type conv struct {
			ID        string
			Title     string
			Model     *string
			CreatedAt time.Time
			UpdatedAt time.Time
		}
		var list []conv
		var ids []string
		for rows.Next() {
			var c conv
			var title, model *string
			var ca, ua time.Time
			if err := rows.Scan(&c.ID, &title, &model, &ca, &ua); err != nil {
				continue
			}
			if title != nil {
				c.Title = *title
			} else {
				c.Title = "New Chat"
			}
			c.Model = model
			c.CreatedAt = ca
			c.UpdatedAt = ua
			list = append(list, c)
			ids = append(ids, c.ID)
		}
		counts := map[string]int64{}
		if len(ids) > 0 {
			crows, _ := convPool.Query(ctx, `SELECT conversation_id, COUNT(*) FROM conversation_messages WHERE conversation_id = ANY($1) GROUP BY conversation_id`, ids)
			if crows != nil {
				defer crows.Close()
				for crows.Next() {
					var cid string
					var cnt int64
					_ = crows.Scan(&cid, &cnt)
					counts[cid] = cnt
				}
			}
		}
		out := []map[string]interface{}{}
		for _, c := range list {
			out = append(out, map[string]interface{}{
				"id": c.ID, "title": c.Title, "model": c.Model,
				"created_at": c.CreatedAt.Format(time.RFC3339),
				"updated_at": c.UpdatedAt.Format(time.RFC3339),
				"message_count": counts[c.ID],
			})
		}
		if out == nil {
			out = []map[string]interface{}{}
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"conversations": out,
			"total":         total,
			"hasMore":       int64(offset+len(list)) < total,
		})
	}
}

func GetHandler(cfg config.Config, pool *pgxpool.Pool, convPool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := auth.RequireSession(r.Header.Get("Authorization"), cfg.JWTSecret)
		if err != nil || convPool == nil {
			fallback(w, r, cfg)
			return
		}
		if isSQLite(cfg.ConversationsDBURL) {
			fallback(w, r, cfg)
			return
		}
		cid := chi.URLParam(r, "conversation_id")
		if cid == "" {
			cid = chi.URLParam(r, "id")
		}
		if cid == "" {
			http.Error(w, `{"detail":"missing id"}`, 400)
			return
		}
		limit := 30
		var before *int64
		all := r.URL.Query().Get("all") == "true"
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, e := strconv.Atoi(v); e == nil {
				limit = n
				if limit < 1 {
					limit = 1
				}
				if limit > 100 {
					limit = 100
				}
			}
		} else if all {
			limit = 100
		}
		if v := r.URL.Query().Get("before"); v != "" {
			if n, e := strconv.ParseInt(v, 10, 64); e == nil {
				before = &n
			}
		}
		ctx := r.Context()
		var convUserID, title string
		var model *string
		var createdAt, updatedAt time.Time
		err = convPool.QueryRow(ctx, `SELECT user_id, title, model, created_at, updated_at FROM conversations WHERE id=$1`, cid).Scan(&convUserID, &title, &model, &createdAt, &updatedAt)
		if err != nil || convUserID != uid {
			fallback(w, r, cfg)
			return
		}
		var total int64
		_ = convPool.QueryRow(ctx, `SELECT COUNT(*) FROM conversation_messages WHERE conversation_id=$1`, cid).Scan(&total)
		// detect encrypted
		var encCount int64
		_ = convPool.QueryRow(ctx, `SELECT COUNT(*) FROM conversation_messages WHERE conversation_id=$1 AND encrypted=true`, cid).Scan(&encCount)
		var key []byte
		if encCount > 0 {
			dateStr := createdAt.Format("2006-01-02")
			key = DeriveKey(uid, cid, dateStr)
		}
		q := `SELECT position, role, content, reasoning, model, usage, attachments, finish_reason, duration_ms, encrypted FROM conversation_messages WHERE conversation_id=$1`
		args := []interface{}{cid}
		if before != nil {
			q += ` AND position < $2 ORDER BY position DESC`
			args = append(args, *before)
			if limit > 0 {
				q += ` LIMIT $3`
				args = append(args, limit)
			}
		} else {
			q += ` ORDER BY position DESC`
			if limit > 0 {
				q += ` LIMIT $2`
				args = append(args, limit)
			}
		}
		rows, err := convPool.Query(ctx, q, args...)
		if err != nil {
			fallback(w, r, cfg)
			return
		}
		defer rows.Close()
		type msg struct {
			Position int64
			Role     string
			Content  string
			Reasoning *string
			Model    *string
			Usage    *string
			Attachments *string
			Finish   *string
			Duration *int64
			Encrypted bool
		}
		var msgs []msg
		for rows.Next() {
			var m msg
			_ = rows.Scan(&m.Position, &m.Role, &m.Content, &m.Reasoning, &m.Model, &m.Usage, &m.Attachments, &m.Finish, &m.Duration, &m.Encrypted)
			msgs = append(msgs, m)
		}
		// reverse to asc
		for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
			msgs[i], msgs[j] = msgs[j], msgs[i]
		}
		// decrypt check: if any encrypted and decrypt fails for first encrypted row, fallback
		outMsgs := []map[string]interface{}{}
		needFallback := false
		for _, m := range msgs {
			content := m.Content
			reasoning := ""
			if m.Reasoning != nil {
				reasoning = *m.Reasoning
			}
			if m.Encrypted && len(key) > 0 {
				dec := DecryptText(key, content)
				// if blob was non-empty but decrypt returns empty and original wasn't empty -> likely key mismatch
				if content != "" && dec == "" && !isBase64Empty(content) {
					needFallback = true
					break
				}
				content = dec
				if reasoning != "" {
					decR := DecryptText(key, reasoning)
					reasoning = decR
				}
			}
			om := map[string]interface{}{"role": m.Role, "content": content, "position": m.Position}
			if reasoning != "" {
				om["reasoning"] = reasoning
			}
			if m.Model != nil {
				om["model"] = *m.Model
			}
			if m.Usage != nil {
				var uj interface{}
				if json.Unmarshal([]byte(*m.Usage), &uj) == nil {
					om["usage"] = uj
				}
			}
			if m.Attachments != nil {
				var aj interface{}
				if json.Unmarshal([]byte(*m.Attachments), &aj) == nil {
					om["attachments"] = aj
				}
			}
			if m.Finish != nil {
				om["finish_reason"] = *m.Finish
			}
			if m.Duration != nil {
				om["durationMs"] = *m.Duration
			}
			outMsgs = append(outMsgs, om)
		}
		if needFallback {
			fallback(w, r, cfg)
			return
		}
		if outMsgs == nil {
			outMsgs = []map[string]interface{}{}
		}
		var oldest *int64
		hasMore := false
		if len(msgs) > 0 {
			o := msgs[0].Position
			oldest = &o
			if limit > 0 {
				if before == nil {
					hasMore = total > int64(len(msgs))
				} else {
					var cnt int64
					_ = convPool.QueryRow(ctx, `SELECT COUNT(*) FROM conversation_messages WHERE conversation_id=$1 AND position < $2`, cid, *oldest).Scan(&cnt)
					hasMore = cnt > 0
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": cid, "title": title, "model": model,
			"created_at": createdAt.Format(time.RFC3339),
			"updated_at": updatedAt.Format(time.RFC3339),
			"messages": outMsgs, "total": total, "hasMore": hasMore, "oldestPosition": oldest,
		})
	}
}

func DeleteHandler(cfg config.Config, pool *pgxpool.Pool, convPool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, err := auth.RequireSession(r.Header.Get("Authorization"), cfg.JWTSecret)
		if err != nil || convPool == nil {
			fallback(w, r, cfg)
			return
		}
		if isSQLite(cfg.ConversationsDBURL) {
			fallback(w, r, cfg)
			return
		}
		cid := chi.URLParam(r, "conversation_id")
		if cid == "" {
			cid = chi.URLParam(r, "id")
		}
		if cid == "" {
			http.Error(w, `{"detail":"missing id"}`, 400)
			return
		}
		ctx := r.Context()
		var owner string
		err = convPool.QueryRow(ctx, `SELECT user_id FROM conversations WHERE id=$1`, cid).Scan(&owner)
		if err != nil || owner != uid {
			fallback(w, r, cfg)
			return
		}
		_, _ = convPool.Exec(ctx, `DELETE FROM conversation_messages WHERE conversation_id=$1`, cid)
		ct, err := convPool.Exec(ctx, `DELETE FROM conversations WHERE id=$1 AND user_id=$2`, cid, uid)
		if err != nil {
			fallback(w, r, cfg)
			return
		}
		if ct.RowsAffected() == 0 {
			http.Error(w, `{"detail":"Conversation not found"}`, 404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
	}
}

func isBase64Empty(s string) bool {
	return s == ""
}

func isSQLite(u string) bool {
	return len(u) >= 6 && (u[:6] == "sqlite" || u[:10] == "sqlite+asi")
}

func fallback(w http.ResponseWriter, r *http.Request, cfg config.Config) {
	target := cfg.BackendURL
	if target == "" {
		http.Error(w, `{"detail":"backend not configured"}`, 502)
		return
	}
	client := &http.Client{Timeout: 10 * 1e9}
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
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
		}
		if err != nil {
			break
		}
	}
}
