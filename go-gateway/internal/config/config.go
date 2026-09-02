package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port               string
	BackendURL         string
	SGLangURL          string
	DashboardURL       string
	RateLimitPerMinute int
	DatabaseURL        string
	ConversationsDBURL string
	JWTSecret          string
	DeepseekURL        string
	DeepseekKey        string
	ZAIURL             string
	ZAIKey             string
	DashScopeURL       string
	DashScopeKey       string
	GrokAPIURL         string
	GrokAPIKey         string
	GrokImageModel     string
	ImageProvider      string
}

func Load() Config {
	rate, _ := strconv.Atoi(envOr("RATE_LIMIT_PER_MINUTE", "60"))
	return Config{
		Port:              envOr("GO_GATEWAY_PORT", "8080"),
		BackendURL:        envOr("BACKEND_URL", "http://backend:8000"),
		SGLangURL:         envOr("SGLANG_URL", "http://localhost:30000"),
		DashboardURL:      envOr("DASHBOARD_URL", "http://localhost:5173"),
		RateLimitPerMinute: rate,
		DatabaseURL:       envOr("DATABASE_URL", ""),
		ConversationsDBURL: envOr("CONVERSATIONS_DB_URL", envOr("DATABASE_URL", "")),
		JWTSecret:         envOr("JWT_SECRET", ""),
		DeepseekURL:       envOr("DEEPSEEK_URL", "https://api.deepseek.com"),
		DeepseekKey:       envOr("DEEPSEEK_API_KEY", ""),
		ZAIURL:            envOr("Z_AI_URL", "https://api.z.ai/api/paas/v4"),
		ZAIKey:            envOr("Z_API_KEY", ""),
		DashScopeURL:      envOr("DASHSCOPE_URL", "https://dashscope-intl.aliyuncs.com"),
		DashScopeKey:      envOr("DASHSCOPE_API_KEY", ""),
		GrokAPIURL:        envOr("GROK_API_URL", "https://api.x.ai/v1"),
		GrokAPIKey:        envOr("GROK_API_KEY", envOr("XAI_API_KEY", "")),
		GrokImageModel:    envOr("GROK_IMAGE_MODEL", "grok-imagine-image"),
		ImageProvider:     envOr("IMAGE_PROVIDER", "auto"),
	}
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
