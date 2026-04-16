package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type OAChatMessage struct {
	Role       string          `json:"role"`
	Content    string          `json:"content,omitempty"`
	Name       string          `json:"name,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
	ToolCalls  []OAToolCall    `json:"tool_calls,omitempty"`
	ToolResult json.RawMessage `json:"-"`
}

type OAToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // "function"
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type OAChatRequest struct {
	Model       string          `json:"model"`
	Messages    []OAChatMessage `json:"messages"`
	Tools       []any           `json:"tools,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
}

type OAChatResponse struct {
	Choices []struct {
		Message OAChatMessage `json:"message"`
	} `json:"choices"`
	Error any `json:"error,omitempty"`
}

func OpenAICompatChat(baseURL, apiKey string, req OAChatRequest) (OAChatMessage, error) {
	baseURL = strings.TrimSpace(baseURL)
	baseURL = strings.TrimRight(baseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	u := baseURL + "/chat/completions"

	b, err := json.Marshal(req)
	if err != nil {
		return OAChatMessage{}, err
	}

	httpReq, _ := http.NewRequest(http.MethodPost, u, bytes.NewReader(b))
	httpReq.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}
	cli := &http.Client{Timeout: 60 * time.Second}
	resp, err := cli.Do(httpReq)
	if err != nil {
		return OAChatMessage{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var body bytes.Buffer
		_, _ = body.ReadFrom(resp.Body)
		return OAChatMessage{}, fmt.Errorf("AI 接口失败: %d %s", resp.StatusCode, body.String())
	}
	var out OAChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return OAChatMessage{}, err
	}
	if len(out.Choices) == 0 {
		return OAChatMessage{}, fmt.Errorf("AI 返回空 choices")
	}
	return out.Choices[0].Message, nil
}

