// Package passwordcrypt 提供 Linux shadow crypt 哈希的解析与验证（用于应急场景下的弱口令检测）。
// 注意：无法从哈希“解密”出明文，只能通过候选口令逐一验证。
package passwordcrypt

import (
	"bufio"
	"errors"
	"io"
	"strings"

	"github.com/GehirnInc/crypt"
	_ "github.com/GehirnInc/crypt/md5_crypt"    // $1$
	_ "github.com/GehirnInc/crypt/sha256_crypt" // $5$
	_ "github.com/GehirnInc/crypt/sha512_crypt" // $6$
)

var ErrNoHash = errors.New("无可用 crypt 哈希")
var ErrUnsupported = errors.New("不支持的哈希前缀（当前支持常见 $1$/$5$/$6$）")

// NormalizeHashInput 接受整行 shadow（user:hash:...）或单独的 crypt 字符串。
func NormalizeHashInput(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", ErrNoHash
	}
	// 整行 /etc/shadow
	if strings.Contains(s, ":") {
		parts := strings.SplitN(s, ":", 3)
		if len(parts) < 2 {
			return "", ErrNoHash
		}
		return normalizeField(parts[1])
	}
	return normalizeField(s)
}

func normalizeField(field string) (string, error) {
	field = strings.TrimSpace(field)
	if field == "" || field == "!" || field == "*" || field == "!!" {
		return "", ErrNoHash
	}
	// 锁定账户常见格式 !$6$...
	if strings.HasPrefix(field, "!") && strings.HasPrefix(field[1:], "$") {
		field = field[1:]
	}
	if !strings.HasPrefix(field, "$") {
		return "", ErrNoHash
	}
	if !crypt.IsHashSupported(field) {
		return "", ErrUnsupported
	}
	return field, nil
}

// Verify 判断 password 是否与 crypt 哈希匹配。
func Verify(hashStr, password string) error {
	if !crypt.IsHashSupported(hashStr) {
		return ErrUnsupported
	}
	c := crypt.NewFromHash(hashStr)
	return c.Verify(hashStr, []byte(password))
}

// CrackResult 表示一次破解尝试的结果。
type CrackResult struct {
	Password string
	Attempts int
	Found    bool
}

// TryInline 按行尝试候选口令（跳过空行与 # 注释）。
func TryInline(hashStr, inline string) CrackResult {
	n := 0
	for _, line := range strings.Split(inline, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		n++
		if Verify(hashStr, line) == nil {
			return CrackResult{Password: line, Attempts: n, Found: true}
		}
	}
	return CrackResult{Attempts: n, Found: false}
}

// TryWordlist 从 r 按行读取候选口令；maxAttempts<=0 表示最多 10_000_000 行。
func TryWordlist(hashStr string, r io.Reader, maxAttempts int, onProgress func(attempts int)) (CrackResult, error) {
	if maxAttempts <= 0 {
		maxAttempts = 10_000_000
	}
	sc := bufio.NewScanner(r)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 1024*1024)

	n := 0
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		n++
		if n > maxAttempts {
			return CrackResult{Attempts: n, Found: false}, errors.New("已达最大尝试次数上限")
		}
		if onProgress != nil && n%5000 == 0 {
			onProgress(n)
		}
		if Verify(hashStr, line) == nil {
			return CrackResult{Password: line, Attempts: n, Found: true}, nil
		}
	}
	if err := sc.Err(); err != nil {
		return CrackResult{Attempts: n, Found: false}, err
	}
	return CrackResult{Attempts: n, Found: false}, nil
}
