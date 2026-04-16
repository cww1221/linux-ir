package main

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"linux-ir-console/internal/ai"
	"linux-ir-console/internal/config"
	"linux-ir-console/internal/passwordcrypt"
	sshx "linux-ir-console/internal/ssh"
)

func (a *App) cfgStore() (*config.Store, error) {
	return config.NewStore("linux-ir-console")
}

func (a *App) GetSettings() (config.Settings, error) {
	s, err := a.cfgStore()
	if err != nil {
		return config.DefaultSettings(), err
	}
	return s.Load()
}

func (a *App) SaveSettings(cfg config.Settings) error {
	s, err := a.cfgStore()
	if err != nil {
		return err
	}
	return s.Save(cfg)
}

func (a *App) ListOllamaModels(baseURL string) ([]string, error) {
	return ai.ListOllamaModels(baseURL)
}

// -------- SFTP (可视化文件管理) --------

type SFTPEntry = sshx.SFTPEntry
type ForwardRule = sshx.ForwardRule

func (a *App) SFTPListDir(remotePath string) ([]SFTPEntry, error) {
	return a.ssh.SFTPListDir(remotePath)
}

// SFTPReadText 读取远端文件内容（用于在线编辑）。默认最大 2MB。
func (a *App) SFTPReadText(remotePath string, maxBytes int64) (string, error) {
	remotePath = strings.TrimSpace(remotePath)
	if remotePath == "" {
		return "", errors.New("remotePath 不能为空")
	}
	if maxBytes <= 0 || maxBytes > 10*1024*1024 {
		maxBytes = 2 * 1024 * 1024
	}
	b, err := a.ssh.SFTPReadFile(remotePath, maxBytes)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// SFTPWriteText 写回远端文件（用于在线编辑保存）。
func (a *App) SFTPWriteText(remotePath string, content string) error {
	remotePath = strings.TrimSpace(remotePath)
	if remotePath == "" {
		return errors.New("remotePath 不能为空")
	}
	return a.ssh.SFTPWriteFile(remotePath, []byte(content))
}

// -------- 本地文件（用于 XFTP 风格双栏）--------

type LocalEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	Mode  string `json:"mode"`
	MTime int64  `json:"mtime"`
	IsDir bool   `json:"isDir"`
}

func (a *App) LocalListDir(localPath string) ([]LocalEntry, error) {
	p := strings.TrimSpace(localPath)
	if p == "" {
		p = "."
	}
	ents, err := os.ReadDir(p)
	if err != nil {
		return nil, err
	}
	out := make([]LocalEntry, 0, len(ents))
	for _, e := range ents {
		info, _ := e.Info()
		isDir := e.IsDir()
		size := int64(0)
		mode := ""
		mtime := int64(0)
		if info != nil {
			size = info.Size()
			mode = info.Mode().String()
			mtime = info.ModTime().Unix()
		}
		out = append(out, LocalEntry{
			Name:  e.Name(),
			Path:  filepath.Join(p, e.Name()),
			Size:  size,
			Mode:  mode,
			MTime: mtime,
			IsDir: isDir,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

func (a *App) LocalReadText(localPath string, maxBytes int64) (string, error) {
	p := strings.TrimSpace(localPath)
	if p == "" {
		return "", errors.New("path 不能为空")
	}
	if maxBytes <= 0 || maxBytes > 10*1024*1024 {
		maxBytes = 2 * 1024 * 1024
	}
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	b := make([]byte, maxBytes)
	n, _ := f.Read(b)
	return string(b[:n]), nil
}

func (a *App) LocalWriteText(localPath string, content string) error {
	p := strings.TrimSpace(localPath)
	if p == "" {
		return errors.New("path 不能为空")
	}
	return os.WriteFile(p, []byte(content), 0644)
}

// SFTPDownloadDialog 选择本地保存路径并下载远端文件
func (a *App) SFTPDownloadDialog(remotePath string) error {
	if strings.TrimSpace(remotePath) == "" {
		return errors.New("remotePath 不能为空")
	}
	dst, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存到本地",
		DefaultFilename: filepath.Base(remotePath),
	})
	if err != nil {
		return err
	}
	if dst == "" {
		return nil
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	return a.ssh.SFTPDownload(remotePath, f)
}

// SFTPUploadDialog 选择本地文件并上传到远端目录
func (a *App) SFTPUploadDialog(remoteDir string) error {
	remoteDir = strings.TrimSpace(remoteDir)
	if remoteDir == "" {
		remoteDir = "."
	}
	src, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要上传的本地文件",
	})
	if err != nil {
		return err
	}
	if src == "" {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	remotePath := remoteDir
	if strings.HasSuffix(remoteDir, "/") || remoteDir == "." {
		remotePath = remoteDir + filepath.Base(src)
	} else {
		remotePath = remoteDir + "/" + filepath.Base(src)
	}
	return a.ssh.SFTPUpload(in, remotePath)
}

// -------- Shadow crypt 哈希验证（词表破解，用于弱口令核查）--------

// CrackShadowRequest 输入 /etc/shadow 一行或裸 crypt 串；无法逆向“解密”，仅验证候选口令。
type CrackShadowRequest struct {
	Input           string `json:"input"`
	InlinePasswords string `json:"inlinePasswords"`
	WordlistPath    string `json:"wordlistPath"`
	MaxAttempts     int    `json:"maxAttempts"`
}

// CrackShadowResponse 破解结果。
type CrackShadowResponse struct {
	Hash     string `json:"hash"`
	Ok       bool   `json:"ok"`
	Password string `json:"password"`
	Attempts int    `json:"attempts"`
	Message  string `json:"message"`
}

func (a *App) CrackShadowHash(req CrackShadowRequest) (CrackShadowResponse, error) {
	hash, err := passwordcrypt.NormalizeHashInput(req.Input)
	if err != nil {
		return CrackShadowResponse{}, err
	}
	inline := passwordcrypt.TryInline(hash, req.InlinePasswords)
	attempts := inline.Attempts
	if inline.Found {
		return CrackShadowResponse{
			Hash: hash, Ok: true, Password: inline.Password, Attempts: attempts,
			Message: "内联候选命中",
		}, nil
	}
	wp := strings.TrimSpace(req.WordlistPath)
	if wp == "" {
		return CrackShadowResponse{
			Hash: hash, Ok: false, Attempts: attempts,
			Message: "未命中：请填写内联候选口令或选择词表文件",
		}, nil
	}
	f, err := os.Open(wp)
	if err != nil {
		return CrackShadowResponse{}, err
	}
	defer f.Close()
	res, err := passwordcrypt.TryWordlist(hash, f, req.MaxAttempts, func(n int) {
		runtime.EventsEmit(a.ctx, "shadowcrack:progress", map[string]any{
			"attempts": n,
		})
	})
	attempts += res.Attempts
	if err != nil {
		return CrackShadowResponse{
			Hash: hash, Ok: false, Attempts: attempts, Message: err.Error(),
		}, nil
	}
	if res.Found {
		return CrackShadowResponse{
			Hash: hash, Ok: true, Password: res.Password, Attempts: attempts,
			Message: "词表命中",
		}, nil
	}
	return CrackShadowResponse{
		Hash: hash, Ok: false, Attempts: attempts, Message: "词表未命中",
	}, nil
}

// CrackShadowPickWordlist 选择本地词表文件（每行一个候选口令）。
func (a *App) CrackShadowPickWordlist() (string, error) {
	p, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择词表文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "文本", Pattern: "*.txt;*.lst;*"},
		},
	})
	if err != nil {
		return "", err
	}
	return p, nil
}

// -------- SSH 隧道（本地端口转发）--------

type StartForwardRequest struct {
	ListenAddr string `json:"listenAddr"` // 127.0.0.1:8080
	RemoteAddr string `json:"remoteAddr"` // 10.0.0.2:80
}

func (a *App) StartLocalForward(req StartForwardRequest) (ForwardRule, error) {
	if strings.TrimSpace(req.ListenAddr) == "" || strings.TrimSpace(req.RemoteAddr) == "" {
		return ForwardRule{}, errors.New("listenAddr/remoteAddr 不能为空")
	}
	return a.ssh.StartLocalForward(req.ListenAddr, req.RemoteAddr)
}

func (a *App) StopLocalForward(id string) error {
	return a.ssh.StopLocalForward(strings.TrimSpace(id))
}

