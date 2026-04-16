package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type OllamaMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type OllamaChatRequest struct {
	Model    string         `json:"model"`
	Messages []OllamaMessage `json:"messages"`
	Stream   bool           `json:"stream"`
}

type OllamaChatResponse struct {
	Message OllamaMessage `json:"message"`
}

func OllamaChat(baseURL, model string, msgs []OllamaMessage) (OllamaMessage, error) {
	baseURL = NormalizeBaseURL(baseURL)
	model = strings.TrimSpace(model)
	if model == "" {
		return OllamaMessage{}, fmt.Errorf("ollama model 不能为空")
	}
	u := strings.TrimRight(baseURL, "/") + "/api/chat"
	req := OllamaChatRequest{Model: model, Messages: msgs, Stream: false}
	b, err := json.Marshal(req)
	if err != nil {
		return OllamaMessage{}, err
	}
	httpReq, _ := http.NewRequest(http.MethodPost, u, bytes.NewReader(b))
	httpReq.Header.Set("Content-Type", "application/json")
	cli := &http.Client{Timeout: 120 * time.Second}
	resp, err := cli.Do(httpReq)
	if err != nil {
		return OllamaMessage{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var body bytes.Buffer
		_, _ = body.ReadFrom(resp.Body)
		return OllamaMessage{}, fmt.Errorf("ollama chat 失败: %d %s", resp.StatusCode, body.String())
	}
	var out OllamaChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return OllamaMessage{}, err
	}
	return out.Message, nil
}

