package ai

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

// 解析 Ollama/通用模型输出中的工具调用块：
// ```tool
// {"name":"SSHExec","arguments":{...}}
// ```
var toolBlockRe = regexp.MustCompile("(?s)```tool\\s*(\\{.*?\\})\\s*```")

type ToolBlock struct {
	Name      string                 `json:"name"`
	Arguments map[string]any         `json:"arguments"`
}

func ExtractFirstToolBlock(text string) (*ToolBlock, string, error) {
	m := toolBlockRe.FindStringSubmatchIndex(text)
	if m == nil {
		return nil, text, nil
	}
	raw := text[m[2]:m[3]]
	var tb ToolBlock
	if err := json.Unmarshal([]byte(raw), &tb); err != nil {
		return nil, text, err
	}
	tb.Name = strings.TrimSpace(tb.Name)
	if tb.Name == "" {
		return nil, text, errors.New("tool name 为空")
	}
	// 将工具块从文本中去掉，留下“给用户看的回复”
	clean := strings.TrimSpace(text[:m[0]] + text[m[1]:])
	return &tb, clean, nil
}

