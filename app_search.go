package main

import (
	"errors"
	"fmt"
	"strings"

	sshx "linux-ir-console/internal/ssh"
)

// FlagSearchRequest 在远端按目录 + 自定义关键字搜索文件名与文件内容（grep 固定字符串）。
type FlagSearchRequest struct {
	Paths           []string `json:"paths"`
	NameKeywords    []string `json:"nameKeywords"`
	ContentKeywords []string `json:"contentKeywords"`
	MaxDepth        int      `json:"maxDepth"`
	MaxMatches      int      `json:"maxMatches"`
	TimeoutSec      int      `json:"timeoutSec"`
}

// SignalPidsRequest 向指定 PID 发送信号（用于人工确认后的矿码处置）。
type SignalPidsRequest struct {
	Pids       []int `json:"pids"`
	Signal     int   `json:"signal"`
	TimeoutSec int   `json:"timeoutSec"`
}

func shellSingleQuote(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `'\''`) + `'`
}

func validateSearchPath(p string) error {
	p = strings.TrimSpace(p)
	if p == "" {
		return errors.New("路径不能为空")
	}
	if len(p) > 512 {
		return errors.New("路径过长")
	}
	if !strings.HasPrefix(p, "/") {
		return errors.New("路径须为绝对路径并以 / 开头")
	}
	if strings.Contains(p, "..") {
		return errors.New("路径不允许包含 ..")
	}
	for _, c := range p {
		if c == ';' || c == '|' || c == '&' || c == '$' || c == '`' || c == '\'' || c == '\n' || c == '\x00' {
			return errors.New("路径含非法字符")
		}
	}
	return nil
}

func validateKeyword(k string) error {
	k = strings.TrimSpace(k)
	if k == "" {
		return errors.New("关键字不能为空")
	}
	if len(k) > 200 {
		return errors.New("单条关键字过长（≤200）")
	}
	for _, r := range k {
		if r < 0x20 || r > 0x7e {
			return errors.New("关键字仅允许 ASCII 可打印字符")
		}
	}
	if strings.ContainsAny(k, ";|&$`\n\r\x00") {
		return errors.New("关键字含非法 shell 字符")
	}
	return nil
}

// validateGrepPattern 用于 grep -rni：固定字符串走原规则；正则模式允许 | 等，仍禁止换行与空字节。
func validateGrepPattern(k string, regex bool) error {
	k = strings.TrimSpace(k)
	if k == "" {
		return errors.New("关键字不能为空")
	}
	if len(k) > 500 {
		return errors.New("关键字过长（≤500）")
	}
	if strings.ContainsAny(k, "\n\r\x00") {
		return errors.New("关键字含非法字符")
	}
	if !regex {
		return validateKeyword(k)
	}
	return nil
}

// GrepRecursiveRequest 等价远端执行 grep -rni（递归、行号、忽略大小写）；默认 -F 固定字符串，可选 -E 正则。
type GrepRecursiveRequest struct {
	Root       string `json:"root"`
	Keyword    string `json:"keyword"`
	MaxLines   int    `json:"maxLines"`
	TimeoutSec int    `json:"timeoutSec"`
	UseRegex   bool   `json:"useRegex"`
}

// SSHGrepRecursive 在远端执行 grep -rniF 或 grep -rniE，输出匹配行（含文件名与行号）。
func (a *App) SSHGrepRecursive(req GrepRecursiveRequest) (sshx.ExecResult, error) {
	if !a.ssh.IsConnected() {
		return sshx.ExecResult{}, errors.New("请先连接 SSH")
	}
	root := strings.TrimSpace(req.Root)
	if err := validateSearchPath(root); err != nil {
		return sshx.ExecResult{}, err
	}
	if err := validateGrepPattern(req.Keyword, req.UseRegex); err != nil {
		return sshx.ExecResult{}, err
	}
	maxLines := req.MaxLines
	if maxLines <= 0 {
		maxLines = 500
	}
	if maxLines > 5000 {
		maxLines = 5000
	}
	t := req.TimeoutSec
	if t <= 0 {
		t = 300
	}
	if t > 900 {
		t = 900
	}
	qr := shellSingleQuote(root)
	qk := shellSingleQuote(strings.TrimSpace(req.Keyword))
	mode := "-rniF --binary-files=without-match"
	if req.UseRegex {
		mode = "-rniE --binary-files=without-match"
	}
	var b strings.Builder
	b.WriteString("export PATH=/usr/bin:/bin; set +e; ")
	b.WriteString("echo '=== grep 递归（等价 grep -rni，输出匹配行）==='; ")
	b.WriteString(fmt.Sprintf("grep %s %s %s 2>/dev/null | head -n %d", mode, qk, qr, maxLines))
	return a.ssh.Exec(a.ctx, b.String(), t)
}

// SSHSearchFlags 在已连接 SSH 的目标上执行 find / grep（固定字符串），结果写入任务输出。
func (a *App) SSHSearchFlags(req FlagSearchRequest) (sshx.ExecResult, error) {
	if !a.ssh.IsConnected() {
		return sshx.ExecResult{}, errors.New("请先连接 SSH")
	}
	if len(req.NameKeywords) == 0 && len(req.ContentKeywords) == 0 {
		return sshx.ExecResult{}, errors.New("请至少填写「文件名关键字」或「文件内容关键字」之一")
	}
	if req.MaxDepth <= 0 {
		req.MaxDepth = 6
	}
	if req.MaxDepth > 15 {
		req.MaxDepth = 15
	}
	if req.MaxMatches <= 0 {
		req.MaxMatches = 120
	}
	if req.MaxMatches > 400 {
		req.MaxMatches = 400
	}
	t := req.TimeoutSec
	if t <= 0 {
		t = 180
	}
	if t > 900 {
		t = 900
	}
	paths := req.Paths
	if len(paths) == 0 {
		paths = []string{"/tmp", "/var/tmp"}
	}
	for _, p := range paths {
		if err := validateSearchPath(p); err != nil {
			return sshx.ExecResult{}, fmt.Errorf("路径 %q: %w", p, err)
		}
	}
	for _, k := range req.NameKeywords {
		if err := validateKeyword(k); err != nil {
			return sshx.ExecResult{}, fmt.Errorf("文件名关键字 %q: %w", k, err)
		}
	}
	for _, k := range req.ContentKeywords {
		if err := validateKeyword(k); err != nil {
			return sshx.ExecResult{}, fmt.Errorf("内容关键字 %q: %w", k, err)
		}
	}

	var b strings.Builder
	b.WriteString("export PATH=/usr/bin:/bin:/usr/sbin:/sbin; set +e; ")
	b.WriteString("echo '=== IR: 文件名 / 内容关键字搜索（自定义） ==='; ")
	for _, root := range paths {
		qr := shellSingleQuote(root)
		for _, kw := range req.NameKeywords {
			pat := shellSingleQuote("*" + kw + "*")
			b.WriteString(fmt.Sprintf(
				"echo '--- find -iname root=%s pat=%s ---'; find %s -xdev -maxdepth %d -type f -iname %s 2>/dev/null | head -n %d; ",
				root, kw, qr, req.MaxDepth, pat, req.MaxMatches))
		}
	}
	for _, root := range paths {
		qr := shellSingleQuote(root)
		for _, kw := range req.ContentKeywords {
			qk := shellSingleQuote(kw)
			b.WriteString(fmt.Sprintf(
				"echo '--- grep -rIF root=%s kw=%s ---'; grep -rIlF --binary-files=without-match %s %s 2>/dev/null | head -n %d; ",
				root, kw, qk, qr, req.MaxMatches))
		}
	}
	cmd := b.String()
	return a.ssh.Exec(a.ctx, cmd, t)
}

// SSHSignalPids 向远端进程发送 SIGTERM(15) 或 SIGKILL(9)。用于确认矿码 PID 后的处置。
func (a *App) SSHSignalPids(req SignalPidsRequest) (sshx.ExecResult, error) {
	if !a.ssh.IsConnected() {
		return sshx.ExecResult{}, errors.New("请先连接 SSH")
	}
	if len(req.Pids) == 0 {
		return sshx.ExecResult{}, errors.New("请填写至少一个 PID")
	}
	if len(req.Pids) > 48 {
		return sshx.ExecResult{}, errors.New("单次最多 48 个 PID")
	}
	sig := req.Signal
	if sig != 9 && sig != 15 {
		return sshx.ExecResult{}, errors.New("signal 仅支持 15(SIGTERM) 或 9(SIGKILL)")
	}
	for _, p := range req.Pids {
		if p < 1 || p > 4194304 {
			return sshx.ExecResult{}, fmt.Errorf("非法 PID: %d", p)
		}
	}
	t := req.TimeoutSec
	if t <= 0 {
		t = 45
	}
	if t > 120 {
		t = 120
	}
	var b strings.Builder
	b.WriteString("export PATH=/usr/bin:/bin; set +e; echo '=== kill 结果 ==='; ")
	for _, p := range req.Pids {
		b.WriteString(fmt.Sprintf("/bin/kill -s %d %d 2>&1; echo 'PID %d -> signal %d, exit='$?; ", sig, p, p, sig))
	}
	return a.ssh.Exec(a.ctx, b.String(), t)
}

// SSHGuardAnalysis 分析指定文件/目录是否被进程占用、是否被 systemd/cron 引用、是否有不可变属性等，便于先停守护再 rm。
func (a *App) SSHGuardAnalysis(path string) (sshx.ExecResult, error) {
	if !a.ssh.IsConnected() {
		return sshx.ExecResult{}, errors.New("请先连接 SSH")
	}
	p := strings.TrimSpace(path)
	if err := validateSearchPath(p); err != nil {
		return sshx.ExecResult{}, err
	}
	q := shellSingleQuote(p)
	var b strings.Builder
	b.WriteString("export PATH=/usr/bin:/bin:/usr/sbin:/sbin; set +e; ")
	b.WriteString(fmt.Sprintf(`T=%s; `, q))
	b.WriteString(`echo "========== 矿码路径：守护/占用分析 =========="; echo "目标: $T"; echo; `)
	b.WriteString(`echo "### 1) 路径存在性与类型"; ls -la "$T" 2>&1; echo; `)
	b.WriteString(`echo "### 2) lsof 直接打开该路径"; command -v lsof >/dev/null && lsof "$T" 2>/dev/null | head -n 80; echo "(说明：此处为空很常见——可执行文件被运行后，段6 全表仍能看到 txt 映射；若文件曾被 unlink 仍执行，段2 也会空)"; echo; `)
	b.WriteString(`echo "### 2b) /proc/<PID>/exe 指向该路径的进程"; for pid in $(ps auxww 2>/dev/null | grep -F "$T" | grep -v grep | awk '{print $2}' | sort -u); do [ -n "$pid" ] && [ -e "/proc/$pid/exe" ] && echo "PID=$pid exe=$(readlink -f /proc/$pid/exe 2>/dev/null || readlink /proc/$pid/exe)"; done; echo; `)
	b.WriteString(`echo "### 3) 若为目录：lsof +D（限时，大目录可能略慢）"; if [ -d "$T" ]; then if command -v timeout >/dev/null 2>&1; then timeout 45 lsof +D "$T" 2>/dev/null | head -n 100; else lsof +D "$T" 2>/dev/null | head -n 100; fi; else echo "(非目录，跳过 +D)"; fi; echo; `)
	b.WriteString(`echo "### 4) fuser"; command -v fuser >/dev/null && fuser -v "$T" 2>&1 | head -n 50; echo; `)
	b.WriteString(`echo "### 5) 进程列表中匹配该路径字符串（采样）"; ps auxww 2>/dev/null | grep -F "$T" | grep -v grep | head -n 40; echo; `)
	b.WriteString(`echo "### 6) lsof 全表 grep 路径（采样，较慢机可能空）"; lsof 2>/dev/null | grep -F "$T" | head -n 60; echo; `)
	b.WriteString(`echo "### 7) systemd 单元文件引用该路径"; for d in /etc/systemd/system /lib/systemd/system /usr/lib/systemd/system; do [ -d "$d" ] && grep -rIl "$T" "$d" 2>/dev/null | head -n 30; done; systemctl list-unit-files --no-pager 2>/dev/null | egrep -i 'miner|xmr|kinsing|watch|stratum' || true; echo; `)
	b.WriteString(`echo "### 8) cron / 计划任务引用"; grep -rIl "$T" /etc/cron* /var/spool/cron /etc/crontab 2>/dev/null | head -n 40; echo; `)
	b.WriteString(`echo "### 9) 扩展属性（chattr +i 会导致无法 rm，需 chattr -i）"; lsattr -d "$T" 2>/dev/null; [ -d "$T" ] && lsattr -a "$T" 2>/dev/null | head -n 30; [ -f "$T" ] && lsattr "$T" 2>/dev/null; echo; `)
	b.WriteString(`echo "### 10) 常见矿码/守护进程名（供对照 PID）"; ps aux 2>/dev/null | egrep -i 'xmrig|minerd|kinsing|watchdog|kdevtmpfsi|stratum|cpuminer' | grep -v egrep | head -n 40; echo; `)
	b.WriteString(`echo "### 11) 【删除方法】自动生成命令（请核对 PID 后再复制到终端执行）"; `)
	b.WriteString(`PIDS=$(ps auxww 2>/dev/null | grep -F "$T" | grep -v grep | awk '{print $2}' | sort -u); `)
	b.WriteString(`if command -v pgrep >/dev/null 2>&1; then PG=$(pgrep -f "$T" 2>/dev/null | tr '\n' ' '); PIDS=$(echo "$PIDS $PG" | tr ' ' '\n' | grep -v '^$' | sort -nu | tr '\n' ' '); fi; `)
	b.WriteString(`echo "# ---------- 第一步：结束占用该路径的进程 ----------"; `)
	b.WriteString(`if [ -z "$(echo $PIDS | tr -d ' ')" ]; then echo "# 未自动解析到 PID，请从上方「### 5」「### 6」中手工抄 PID，在侧栏「对 PID 发信号」结束进程"; else for pid in $PIDS; do [ -n "$pid" ] && echo "kill -15 $pid"; done; echo "sleep 2"; for pid in $PIDS; do [ -n "$pid" ] && echo "kill -9 $pid"; done; fi; `)
	b.WriteString(`echo "# ---------- 第二步：确认进程已消失后再删文件 ----------"; `)
	b.WriteString(`echo "ps auxww | grep -F \"$T\" | grep -v grep || echo '(无匹配，可继续 rm)'"; `)
	b.WriteString(`echo "# ---------- 第三步：删除二进制与同目录 pid 文件 ----------"; `)
	b.WriteString(`echo "rm -f \"$T\" \"${T}.pid\""; `)
	b.WriteString(`echo "# 若还有同名变体可执行: ls -la $(dirname \"$T\") | head -n 50"; `)
	b.WriteString(`echo "# ---------- 若 rm 仍报 Operation not permitted：先 lsattr，再 chattr -i <文件> 后重试 rm ----------"; `)
	b.WriteString(`echo "### 12) 补充：侧栏可粘贴 PID 批量发 SIGKILL，删完若文件复活请再查 systemd/cron/本脚本段7-8"; `)
	b.WriteString(`echo "=========================================="; `)
	return a.ssh.Exec(a.ctx, b.String(), 150)
}
