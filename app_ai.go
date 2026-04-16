package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"linux-ir-console/internal/ai"
	"linux-ir-console/internal/config"
)

type ChatMessage struct {
	Role    string `json:"role"`    // system|user|assistant|tool
	Content string `json:"content"` // plain text
}

type ChatRequest struct {
	Messages []ChatMessage `json:"messages"`
}

type ChatResponse struct {
	Assistant string `json:"assistant"`
	// 工具执行日志（给前端展示/高亮）
	ToolLog string `json:"toolLog"`
	Pending *PendingToolCall `json:"pending,omitempty"`
}

type PendingToolCall struct {
	Name   string         `json:"name"`
	Args   map[string]any `json:"args"`
	Risk   string         `json:"risk"`   // low|medium|high
	Reason string         `json:"reason"` // why pending
}

func (a *App) AIChat(req ChatRequest) (ChatResponse, error) {
	st, err := a.GetSettings()
	if err != nil {
		st = config.DefaultSettings()
	}
	if len(req.Messages) == 0 {
		return ChatResponse{}, errors.New("messages 不能为空")
	}

	// 系统提示：指导模型如何调用工具
	sys := ChatMessage{
		Role: "system",
		// 注意：此处不能在 raw string 中直接包含 ```，否则会提前结束字符串。
		Content: strings.TrimSpace(`
你是 Linux 应急响应/运维助手。你可以通过“工具”来帮用户执行操作，但必须遵循：
- 仅调用提供的工具；优先只读采集/分析
- 涉及破坏性命令（rm/mkfs/dd/iptables flush 等）必须先征询用户确认（用文字说明风险），不要直接执行
- 远端执行相关工具需要先 SSH 已连接；如果没连接，提示用户先连接

当你需要调用工具时，请输出一个工具块（只输出一个），格式如下（用三反引号包裹，标签为 tool）：
【三反引号 tool】
{"name":"TOOL_NAME","arguments":{...}}
【三反引号结束】
工具块之外的内容是给用户看的解释/结论。
可用工具（部分）：
- SSHExec: {command, timeoutSec}
- RunPlaybookItem: {itemId, vars}
- SFTPListDir: {remotePath}
- StartLocalForward: {listenAddr, remoteAddr}
`),
	}

	// 将前端消息规范化
	msgs := []ChatMessage{sys}
	for _, m := range req.Messages {
		r := strings.TrimSpace(m.Role)
		if r == "" {
			r = "user"
		}
		msgs = append(msgs, ChatMessage{Role: r, Content: m.Content})
	}

	switch st.AIProvider {
	case config.AIProviderOllama:
		return a.aiChatOllama(st, msgs)
	case config.AIProviderOpenAI:
		return a.aiChatOpenAI(st, msgs)
	case config.AIProviderNone:
		return ChatResponse{}, errors.New("AI 未启用（Settings.aiProvider=none）")
	default:
		return ChatResponse{}, errors.New("未知 AIProvider: " + string(st.AIProvider))
	}
}

func (a *App) aiChatOllama(st config.Settings, msgs []ChatMessage) (ChatResponse, error) {
	omsgs := make([]ai.OllamaMessage, 0, len(msgs))
	for _, m := range msgs {
		omsgs = append(omsgs, ai.OllamaMessage{Role: m.Role, Content: m.Content})
	}
	reply, err := ai.OllamaChat(st.OllamaBaseURL, st.OllamaModel, omsgs)
	if err != nil {
		return ChatResponse{}, err
	}
	tb, clean, err := ai.ExtractFirstToolBlock(reply.Content)
	if err != nil {
		return ChatResponse{Assistant: reply.Content}, nil
	}
	if tb == nil {
		return ChatResponse{Assistant: reply.Content}, nil
	}

	toolText, toolErr := a.executeAITool(tb.Name, tb.Arguments)
	out := clean
	if out == "" {
		out = "（已执行工具）"
	}
	if toolErr != nil {
		if p := asPending(toolErr); p != nil {
			return ChatResponse{Assistant: out, Pending: p}, nil
		}
		return ChatResponse{Assistant: out, ToolLog: toolText + "\n[-] tool error: " + toolErr.Error()}, nil
	}
	return ChatResponse{Assistant: out, ToolLog: toolText}, nil
}

func (a *App) aiChatOpenAI(st config.Settings, msgs []ChatMessage) (ChatResponse, error) {
	// OpenAI 兼容：先发一次，不做复杂多轮工具循环（MVP），只处理一批 tool_calls
	oMsgs := make([]ai.OAChatMessage, 0, len(msgs))
	for _, m := range msgs {
		oMsgs = append(oMsgs, ai.OAChatMessage{Role: m.Role, Content: m.Content})
	}

	tools := []any{
		map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        "SSHExec",
				"description": "在已连接的远端执行单条命令（只读优先）",
				"parameters": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"command":    map[string]any{"type": "string"},
						"timeoutSec": map[string]any{"type": "integer"},
					},
					"required": []string{"command"},
				},
			},
		},
		map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        "RunPlaybookItem",
				"description": "执行一个 Playbook 检查项",
				"parameters": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"itemId": map[string]any{"type": "string"},
						"vars":   map[string]any{"type": "object"},
					},
					"required": []string{"itemId"},
				},
			},
		},
		map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        "SFTPListDir",
				"description": "列出远端目录",
				"parameters": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"remotePath": map[string]any{"type": "string"},
					},
				},
			},
		},
		map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        "StartLocalForward",
				"description": "启动本地端口转发",
				"parameters": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"listenAddr": map[string]any{"type": "string"},
						"remoteAddr": map[string]any{"type": "string"},
					},
					"required": []string{"listenAddr", "remoteAddr"},
				},
			},
		},
	}

	msg, err := ai.OpenAICompatChat(st.OpenAIBaseURL, st.OpenAIAPIKey, ai.OAChatRequest{
		Model:       st.OpenAIModel,
		Messages:    oMsgs,
		Tools:       tools,
		Temperature: 0.2,
		Stream:      false,
	})
	if err != nil {
		return ChatResponse{}, err
	}

	toolLog := ""
	if len(msg.ToolCalls) > 0 {
		for _, tc := range msg.ToolCalls {
			args := map[string]any{}
			_ = json.Unmarshal([]byte(tc.Function.Arguments), &args)
			t, e := a.executeAITool(tc.Function.Name, args)
			if p := asPending(e); p != nil {
				return ChatResponse{
					Assistant: strings.TrimSpace(msg.Content),
					Pending:   p,
				}, nil
			}
			toolLog += fmt.Sprintf("[tool=%s]\n%s\n", tc.Function.Name, t)
			if e != nil {
				toolLog += "[-] tool error: " + e.Error() + "\n"
			}
		}
	}

	return ChatResponse{Assistant: strings.TrimSpace(msg.Content), ToolLog: strings.TrimSpace(toolLog)}, nil
}

type pendingErr struct {
	name   string
	args   map[string]any
	risk   string
	reason string
}

func (e pendingErr) Error() string { return e.reason }

func asPending(err error) *PendingToolCall {
	if err == nil {
		return nil
	}
	var pe pendingErr
	if errors.As(err, &pe) {
		return &PendingToolCall{Name: pe.name, Args: pe.args, Risk: pe.risk, Reason: pe.reason}
	}
	return nil
}

func (a *App) executeAITool(name string, args map[string]any) (string, error) {
	name = strings.TrimSpace(name)
	switch name {
	case "SSHExec":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		cmd, _ := args["command"].(string)
		if risk, reason, ok := isDangerousCommand(cmd); ok {
			return "", pendingErr{name: name, args: args, risk: risk, reason: reason}
		}
		t := 20
		if v, ok := args["timeoutSec"].(float64); ok {
			t = int(v)
		}
		res, err := a.ssh.Exec(a.ctx, cmd, t)
		return fmt.Sprintf("$ %s\n%s%s\n[exit=%d ms=%d]", res.Command, res.Stdout, res.Stderr, res.ExitCode, res.DurationMs), err

	case "RunPlaybookItem":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		itemID, _ := args["itemId"].(string)
		vars := map[string]string{}
		if m, ok := args["vars"].(map[string]any); ok {
			for k, v := range m {
				if s, ok := v.(string); ok {
					vars[k] = s
				}
			}
		}
		res, err := a.RunPlaybookItem(RunItemRequest{ItemID: itemID, Vars: vars})
		return fmt.Sprintf("$ %s\n%s%s\n[exit=%d ms=%d]", res.Command, res.Stdout, res.Stderr, res.ExitCode, res.DurationMs), err

	case "SFTPListDir":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		p, _ := args["remotePath"].(string)
		list, err := a.SFTPListDir(p)
		if err != nil {
			return "", err
		}
		b, _ := json.MarshalIndent(list, "", "  ")
		return string(b), nil

	case "SSHSearchFlags":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		// 复用既有请求结构
		raw, _ := json.Marshal(args)
		var r FlagSearchRequest
		_ = json.Unmarshal(raw, &r)
		res, err := a.SSHSearchFlags(r)
		return fmt.Sprintf("$ %s\n%s%s\n[exit=%d ms=%d]", res.Command, res.Stdout, res.Stderr, res.ExitCode, res.DurationMs), err

	case "SSHGrepRecursive":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		raw, _ := json.Marshal(args)
		var r GrepRecursiveRequest
		_ = json.Unmarshal(raw, &r)
		res, err := a.SSHGrepRecursive(r)
		return fmt.Sprintf("$ %s\n%s%s\n[exit=%d ms=%d]", res.Command, res.Stdout, res.Stderr, res.ExitCode, res.DurationMs), err

	case "SSHGuardAnalysis":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		path, _ := args["path"].(string)
		res, err := a.SSHGuardAnalysis(path)
		return fmt.Sprintf("$ %s\n%s%s\n[exit=%d ms=%d]", res.Command, res.Stdout, res.Stderr, res.ExitCode, res.DurationMs), err

	case "SSHSignalPids":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		// kill 属于高风险，要求确认
		return "", pendingErr{name: name, args: args, risk: "high", reason: "即将向远端进程发送 kill 信号（高风险），请在界面确认后再执行"}

	case "StartLocalForward":
		if !a.ssh.IsConnected() {
			return "", errors.New("未连接 SSH")
		}
		la, _ := args["listenAddr"].(string)
		ra, _ := args["remoteAddr"].(string)
		r, err := a.StartLocalForward(StartForwardRequest{ListenAddr: la, RemoteAddr: ra})
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("started id=%s %s -> %s", r.ID, r.Listen, r.Remote), nil

	default:
		return "", errors.New("不支持的工具: " + name)
	}
}

func isDangerousCommand(cmd string) (risk, reason string, pending bool) {
	s := strings.TrimSpace(cmd)
	low := strings.ToLower(s)
	// 非常粗暴的高危匹配（MVP），后续可以做更精细解析
	danger := []string{
		"rm -rf /", "rm -fr /", "mkfs", "dd if=", "shutdown", "reboot", "halt",
		"iptables -f", "iptables -F", "nft flush", "wipefs", ":(){", "userdel", "passwd ",
	}
	for _, k := range danger {
		if strings.Contains(low, strings.ToLower(k)) {
			return "high", "检测到高危命令片段：" + k + "，请在界面确认后再执行", true
		}
	}
	return "", "", false
}

// AIToolExecute 由用户确认后手工触发（绕过 AI 再次生成），用于高危动作执行
type ToolExecuteRequest struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

type ToolExecuteResponse struct {
	ToolLog string `json:"toolLog"`
}

func (a *App) AIToolExecute(req ToolExecuteRequest) (ToolExecuteResponse, error) {
	if strings.TrimSpace(req.Name) == "" {
		return ToolExecuteResponse{}, errors.New("name 不能为空")
	}
	txt, err := a.executeAITool(req.Name, req.Args)
	// 对于 pending 的工具，这里认为已确认，因此执行真正动作：
	if p := asPending(err); p != nil {
		// 目前仅放行 SSHSignalPids 与高危 SSHExec（把确认逻辑放到这里）
		switch req.Name {
		case "SSHSignalPids":
			raw, _ := json.Marshal(req.Args)
			var r SignalPidsRequest
			_ = json.Unmarshal(raw, &r)
			res, e2 := a.SSHSignalPids(r)
			if e2 != nil {
				return ToolExecuteResponse{}, e2
			}
			return ToolExecuteResponse{ToolLog: fmt.Sprintf("$ %s\n%s%s\n[exit=%d ms=%d]", res.Command, res.Stdout, res.Stderr, res.ExitCode, res.DurationMs)}, nil
		case "SSHExec":
			cmd, _ := req.Args["command"].(string)
			t := 20
			if v, ok := req.Args["timeoutSec"].(float64); ok {
				t = int(v)
			}
			res, e2 := a.ssh.Exec(a.ctx, cmd, t)
			if e2 != nil {
				return ToolExecuteResponse{}, e2
			}
			return ToolExecuteResponse{ToolLog: fmt.Sprintf("$ %s\n%s%s\n[exit=%d ms=%d]", res.Command, res.Stdout, res.Stderr, res.ExitCode, res.DurationMs)}, nil
		default:
			return ToolExecuteResponse{}, errors.New("该高危工具暂不支持确认执行: " + req.Name)
		}
	}
	if err != nil {
		return ToolExecuteResponse{}, err
	}
	return ToolExecuteResponse{ToolLog: txt}, nil
}

