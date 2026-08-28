package conversations

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
)

var namespace = []byte("detroit-llm-conversation-v1")

func DeriveKey(userID, chatID, chatDate string) []byte {
	material := fmt.Sprintf("%s:%s:%s", userID, chatID, chatDate)
	h := sha256.Sum256(append(namespace, []byte(material)...))
	return h[:]
}

func DecryptText(key []byte, blob string) string {
	if blob == "" {
		return ""
	}
	raw, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return ""
	}
	if len(raw) < 13 {
		return ""
	}
	nonce, ct := raw[:12], raw[12:]
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	pt, err := aead.Open(nil, nonce, ct, nil)
	if err != nil {
		return ""
	}
	return string(pt)
}
