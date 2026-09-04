# Detroit LLM Gateway Privacy Policy

**Effective: September 4, 2026.** Data controller: **Detroit LLM / MIKKUCN** (chat.khain.app)

This policy explains how we collect, use, and protect your data when you use Detroit LLM Gateway web chat and OpenAI-compatible API.

## 1. Data we collect

- **Account and verification:** Google email, Google sub, YouTube channel ID and membership status (via Google OAuth / YouTube Data API)
- **Direct payments:** Stripe customer/subscription/payment-intent/invoice IDs and transaction history (we **never** store card numbers — cards stay with Stripe)
- **API keys:** stored hashed with their prefix (`sk-dt-...`), creation/last-use dates, and status (the raw key is shown once at creation). Some secrets are encrypted at rest.
- **Usage logs:** model used, prompt/completion/total tokens, timestamps, and which API key was used
- **Conversations (web chat page only — API content is never stored):** messages, attachments (image/video/text), reasoning/metadata, like/dislike reactions. Paid-tier message content is encrypted and kept in a separate database from account data.
- **Files/images:** uploads or generated images may be stored on R2 storage with monthly usage records
- **Technical:** JWT session tokens (~7-day TTL), rate-limit/health logs, and browser localStorage for language/consent flags (`dlg_legal_lang`, consent flag)

## 2. How we use it

- Verify entitlement (membership/paid tier)
- Enforce token/image quotas and rate limits (quota counting, anti-spam)
- Operate chat/API, debug and improve performance
- Render your **Usage**/payment history

## 3. Google / YouTube API data

**Google User Data / YouTube API** data is used strictly for authentication and membership verification and is never shared with third parties. Use complies with the **Google API Services Limited Use** policy.

## 4. Third-party processors

Your prompts are sent only to the provider of the model you select: **DeepSeek**, **Alibaba Cloud DashScope (Qwen)**, **Z.AI (GLM)**, **Anthropic (Claude)**, **Google (Gemini)**, **xAI (Grok)**, and **OpenRouter** (fallback) — plus **Stripe** (payments) and **R2** (file storage). Data is handled under each provider's terms. We **never sell** or exchange your personal data or chat history for commercial gain.

## 5. Security

Appropriate measures: **key hashing**, **at-rest encryption** of sensitive values, **JWT sessions**, separate conversation database, owner/admin access controls, and billing handled only via Stripe/YouTube (we store no financial/card data).

## 6. Retention and deletion

**Storage scope — important:**
- **All tiers — web chat page:** conversations held through the web chat page are saved so you can revisit/continue them.
- **All tiers — API calls:** calls made through the API (`/v1/*` with an API key) record only **usage metadata** (model, token counts, timestamp) for quota/billing — **message content is NOT stored**.
- **Paid tiers — encryption:** paid-tier chat history is **encrypted at rest** (a key unique per user + conversation) so that **only the account owner** can read it back — not even our staff can read the plaintext.

- Web-chat history can be deleted by you in the app.
- You can request deletion of history/stored data via our support channel ([Discord](https://discord.gg/KuMVmcK3cC)). Backups (if any) carry the same protections.
- You may disconnect or stop using the service at any time; access ends with your membership/subscription status.

## 7. Your rights, cookies, and updates

You may request **access, correction, and deletion** of your data via the channel above. The browser stores only the session token and language/consent settings; no third-party ad trackers on the Legal pages. This policy may be updated as appropriate, with material changes announced through the service channels.
