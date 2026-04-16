package ai

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type OllamaTagsResponse struct {
	Models []struct {
		Name string `json:"name"`
	} `json:"models"`
}

func NormalizeBaseURL(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "http://127.0.0.1:11434"
	}
	s = strings.TrimRight(s, "/")
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		return s
	}
	return "http://" + s
}

func ListOllamaModels(baseURL string) ([]string, error) {
	baseURL = NormalizeBaseURL(baseURL)
	u := baseURL + "/api/tags"
	cli := &http.Client{Timeout: 4 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	resp, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ollama 返回状态码 %d", resp.StatusCode)
	}
	var tr OllamaTagsResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	var out []string
	for _, m := range tr.Models {
		n := strings.TrimSpace(m.Name)
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	if len(out) == 0 {
		return nil, errors.New("未发现本地 Ollama 模型（tags 为空）")
	}
	return out, nil
}

