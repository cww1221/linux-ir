package sshx

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/net/proxy"
)

type Auth struct {
	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"` // PEM, optional
	Passphrase string `json:"passphrase"` // for encrypted private keys, optional
}

type ConnectConfig struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Auth        Auth   `json:"auth"`
	DialTimeout int    `json:"dialTimeout"` // seconds, 0 => default 10

	Proxy ProxyConfig `json:"proxy"`
	Jump  *JumpHost   `json:"jump"`
	HostKey HostKeyPolicy `json:"hostKey"`
}

type ProxyConfig struct {
	Type     string `json:"type"` // none|socks5|http
	Address  string `json:"address"`
	Username string `json:"username"`
	Password string `json:"password"`
}

type JumpHost struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Auth        Auth   `json:"auth"`
	DialTimeout int    `json:"dialTimeout"`
}

type HostKeyPolicy struct {
	Mode        string `json:"mode"`        // insecure|trust_on_first_use
	Fingerprint string `json:"fingerprint"` // sha256, for TOFU pinning
}

type ExecResult struct {
	Command   string `json:"command"`
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	ExitCode  int    `json:"exitCode"`
	DurationMs int64 `json:"durationMs"`
}

type Manager struct {
	mu     sync.RWMutex
	client *ssh.Client
	sftp   *sftp.Client
	closers []io.Closer

	shellMu     sync.Mutex
	shellSess   *ssh.Session
	shellIn     io.WriteCloser
	shellOut    io.Reader
	shellErrOut io.Reader

	forwardMu sync.Mutex
	forwards  map[string]net.Listener
}

func (m *Manager) IsConnected() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.client != nil
}

func (m *Manager) Disconnect() error {
	m.shellMu.Lock()
	if m.shellSess != nil {
		_ = m.shellSess.Close()
		m.shellSess = nil
	}
	if m.shellIn != nil {
		_ = m.shellIn.Close()
		m.shellIn = nil
	}
	m.shellOut = nil
	m.shellErrOut = nil
	m.shellMu.Unlock()

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client == nil {
		return nil
	}
	if m.sftp != nil {
		_ = m.sftp.Close()
		m.sftp = nil
	}
	for _, c := range m.closers {
		_ = c.Close()
	}
	m.closers = nil
	err := m.client.Close()
	m.client = nil
	return err
}

func (m *Manager) Connect(cfg ConnectConfig) error {
	if cfg.Host == "" || cfg.Username == "" {
		return errors.New("host/username 不能为空")
	}
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	timeout := 10 * time.Second
	if cfg.DialTimeout > 0 {
		timeout = time.Duration(cfg.DialTimeout) * time.Second
	}

	authMethods, err := buildAuthMethods(cfg.Auth)
	if err != nil {
		return err
	}

	hostKeyCb := ssh.InsecureIgnoreHostKey()
	if cfg.HostKey.Mode == "" {
		cfg.HostKey.Mode = "insecure"
	}
	if cfg.HostKey.Mode == "trust_on_first_use" {
		// 如果传了指纹则校验，否则第一次连接时采集指纹（由上层保存后再传入）
		hostKeyCb = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			fp := FingerprintSHA256(key)
			if cfg.HostKey.Fingerprint == "" {
				return fmt.Errorf("TOFU 需要先信任指纹: %s", fp)
			}
			if fp != cfg.HostKey.Fingerprint {
				return fmt.Errorf("主机指纹不匹配: want=%s got=%s", cfg.HostKey.Fingerprint, fp)
			}
			return nil
		}
	}

	sshCfg := &ssh.ClientConfig{
		User:            cfg.Username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCb,
		Timeout:         timeout,
	}

	conn, closers, err := dialSSH(cfg, sshCfg, timeout)
	if err != nil {
		return err
	}

	m.mu.Lock()
	if m.client != nil {
		_ = m.client.Close()
	}
	m.client = conn
	m.closers = closers
	if m.sftp != nil {
		_ = m.sftp.Close()
		m.sftp = nil
	}
	m.forwardMu.Lock()
	for id, ln := range m.forwards {
		_ = ln.Close()
		delete(m.forwards, id)
	}
	m.forwardMu.Unlock()
	m.mu.Unlock()
	return nil
}

func dialSSH(cfg ConnectConfig, sshCfg *ssh.ClientConfig, timeout time.Duration) (*ssh.Client, []io.Closer, error) {
	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	// 1) 可选 Jump Host
	if cfg.Jump != nil && cfg.Jump.Host != "" && cfg.Jump.Username != "" {
		j := cfg.Jump
		if j.Port == 0 {
			j.Port = 22
		}
		jTimeout := timeout
		if j.DialTimeout > 0 {
			jTimeout = time.Duration(j.DialTimeout) * time.Second
		}
		jAuth, err := buildAuthMethods(j.Auth)
		if err != nil {
			return nil, nil, err
		}
		jCfg := &ssh.ClientConfig{
			User:            j.Username,
			Auth:            jAuth,
			HostKeyCallback: ssh.InsecureIgnoreHostKey(),
			Timeout:         jTimeout,
		}

		jDial, err := buildProxyDialer(cfg.Proxy, jTimeout)
		if err != nil {
			return nil, nil, err
		}
		jConn, err := jDial.Dial("tcp", net.JoinHostPort(j.Host, fmt.Sprintf("%d", j.Port)))
		if err != nil {
			return nil, nil, err
		}
		cc, chans, reqs, err := ssh.NewClientConn(jConn, net.JoinHostPort(j.Host, fmt.Sprintf("%d", j.Port)), jCfg)
		if err != nil {
			_ = jConn.Close()
			return nil, nil, err
		}
		jClient := ssh.NewClient(cc, chans, reqs)

		targetConn, err := jClient.Dial("tcp", addr)
		if err != nil {
			_ = jClient.Close()
			return nil, nil, err
		}
		tcc, tChans, tReqs, err := ssh.NewClientConn(targetConn, addr, sshCfg)
		if err != nil {
			_ = targetConn.Close()
			_ = jClient.Close()
			return nil, nil, err
		}
		c := ssh.NewClient(tcc, tChans, tReqs)
		return c, []io.Closer{jClient}, nil
	}

	// 2) 直连（可选代理）
	d, err := buildProxyDialer(cfg.Proxy, timeout)
	if err != nil {
		return nil, nil, err
	}
	rawConn, err := d.Dial("tcp", addr)
	if err != nil {
		return nil, nil, err
	}
	cc, chans, reqs, err := ssh.NewClientConn(rawConn, addr, sshCfg)
	if err != nil {
		_ = rawConn.Close()
		return nil, nil, err
	}
	return ssh.NewClient(cc, chans, reqs), nil, nil
}

func buildProxyDialer(p ProxyConfig, timeout time.Duration) (proxy.Dialer, error) {
	t := p.Type
	if t == "" || t == "none" {
		return &net.Dialer{Timeout: timeout}, nil
	}
	switch t {
	case "socks5":
		auth := &proxy.Auth{}
		if p.Username != "" || p.Password != "" {
			auth.User = p.Username
			auth.Password = p.Password
		} else {
			auth = nil
		}
		return proxy.SOCKS5("tcp", p.Address, auth, &net.Dialer{Timeout: timeout})
	case "http":
		return httpConnectDialer{proxyAddr: p.Address, username: p.Username, password: p.Password, timeout: timeout}, nil
	default:
		return nil, fmt.Errorf("未知代理类型: %s", t)
	}
}

type httpConnectDialer struct {
	proxyAddr string
	username  string
	password  string
	timeout   time.Duration
}

func (d httpConnectDialer) Dial(network, addr string) (net.Conn, error) {
	if network == "" {
		network = "tcp"
	}
	c, err := (&net.Dialer{Timeout: d.timeout}).Dial(network, d.proxyAddr)
	if err != nil {
		return nil, err
	}
	// HTTP CONNECT
	req := &http.Request{
		Method: http.MethodConnect,
		URL:    &url.URL{Opaque: addr},
		Host:   addr,
		Header: make(http.Header),
	}
	if d.username != "" || d.password != "" {
		req.SetBasicAuth(d.username, d.password)
	}
	if err := req.Write(c); err != nil {
		_ = c.Close()
		return nil, err
	}
	resp, err := http.ReadResponse(bufioNewReader(c), req)
	if err != nil {
		_ = c.Close()
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_ = c.Close()
		return nil, fmt.Errorf("proxy connect failed: %s", resp.Status)
	}
	return c, nil
}

// bufio reader shim (avoid exposing bufio in struct)
func bufioNewReader(r io.Reader) *bufio.Reader {
	return bufio.NewReaderSize(r, 32*1024)
}

func FingerprintSHA256(key ssh.PublicKey) string {
	sum := sha256.Sum256(key.Marshal())
	return fmt.Sprintf("SHA256:%x", sum[:])
}

// SFTP
func (m *Manager) getSFTP() (*sftp.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client == nil {
		return nil, errors.New("未连接到 SSH")
	}
	if m.sftp != nil {
		return m.sftp, nil
	}
	c, err := sftp.NewClient(m.client)
	if err != nil {
		return nil, err
	}
	m.sftp = c
	return m.sftp, nil
}

type SFTPEntry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	Mode  string `json:"mode"`
	MTime int64  `json:"mtime"`
	IsDir bool   `json:"isDir"`
}

func (m *Manager) SFTPListDir(path string) ([]SFTPEntry, error) {
	c, err := m.getSFTP()
	if err != nil {
		return nil, err
	}
	if path == "" {
		path = "."
	}
	infos, err := c.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]SFTPEntry, 0, len(infos))
	for _, fi := range infos {
		out = append(out, SFTPEntry{
			Name:  fi.Name(),
			Path: joinRemote(path, fi.Name()),
			Size:  fi.Size(),
			Mode:  fi.Mode().String(),
			MTime: fi.ModTime().Unix(),
			IsDir: fi.IsDir(),
		})
	}
	return out, nil
}

func joinRemote(dir, name string) string {
	if dir == "" || dir == "." {
		return name
	}
	if dir[len(dir)-1] == '/' {
		return dir + name
	}
	return dir + "/" + name
}

func (m *Manager) SFTPReadFile(path string, maxBytes int64) ([]byte, error) {
	c, err := m.getSFTP()
	if err != nil {
		return nil, err
	}
	f, err := c.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if maxBytes <= 0 || maxBytes > 10*1024*1024 {
		maxBytes = 10 * 1024 * 1024
	}
	return io.ReadAll(io.LimitReader(f, maxBytes))
}

func (m *Manager) SFTPWriteFile(path string, data []byte) error {
	c, err := m.getSFTP()
	if err != nil {
		return err
	}
	f, err := c.OpenFile(path, (os.O_CREATE | os.O_TRUNC | os.O_WRONLY))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}

func (m *Manager) SFTPUpload(local io.Reader, remotePath string) error {
	c, err := m.getSFTP()
	if err != nil {
		return err
	}
	f, err := c.OpenFile(remotePath, (os.O_CREATE | os.O_TRUNC | os.O_WRONLY))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, local)
	return err
}

func (m *Manager) SFTPDownload(remotePath string, w io.Writer) error {
	c, err := m.getSFTP()
	if err != nil {
		return err
	}
	f, err := c.Open(remotePath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(w, f)
	return err
}

// Local forwarding
type ForwardRule struct {
	ID        string `json:"id"`
	Listen    string `json:"listen"`
	Remote    string `json:"remote"`
	StartedAt int64  `json:"startedAt"`
}

func (m *Manager) StartLocalForward(listenAddr, remoteAddr string) (ForwardRule, error) {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return ForwardRule{}, errors.New("未连接到 SSH")
	}
	ln, err := net.Listen("tcp", listenAddr)
	if err != nil {
		return ForwardRule{}, err
	}
	id := uuid.NewString()
	rule := ForwardRule{ID: id, Listen: listenAddr, Remote: remoteAddr, StartedAt: time.Now().Unix()}

	m.forwardMu.Lock()
	if m.forwards == nil {
		m.forwards = map[string]net.Listener{}
	}
	m.forwards[id] = ln
	m.forwardMu.Unlock()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(in net.Conn) {
				defer in.Close()
				out, err := c.Dial("tcp", remoteAddr)
				if err != nil {
					return
				}
				defer out.Close()
				go io.Copy(out, in)
				io.Copy(in, out)
			}(conn)
		}
	}()

	return rule, nil
}

func (m *Manager) StopLocalForward(id string) error {
	m.forwardMu.Lock()
	defer m.forwardMu.Unlock()
	if m.forwards == nil {
		return nil
	}
	ln, ok := m.forwards[id]
	if !ok {
		return nil
	}
	_ = ln.Close()
	delete(m.forwards, id)
	return nil
}

// DialTCP 通过当前 SSH 会话建立到远端 TCP 地址的连接（例如靶机本机 MySQL 127.0.0.1:3306）。
func (m *Manager) DialTCP(remoteAddr string) (net.Conn, error) {
	remoteAddr = strings.TrimSpace(remoteAddr)
	if remoteAddr == "" {
		return nil, errors.New("remoteAddr 不能为空")
	}
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return nil, errors.New("未连接到 SSH")
	}
	return c.Dial("tcp", remoteAddr)
}

func buildAuthMethods(a Auth) ([]ssh.AuthMethod, error) {
	var out []ssh.AuthMethod
	if a.Password != "" {
		out = append(out, ssh.Password(a.Password))
	}
	if a.PrivateKey != "" {
		signer, err := parseSigner(a.PrivateKey, a.Passphrase)
		if err != nil {
			return nil, err
		}
		out = append(out, ssh.PublicKeys(signer))
	}
	if len(out) == 0 {
		return nil, errors.New("请提供密码或私钥")
	}
	return out, nil
}

func parseSigner(pemKey, passphrase string) (ssh.Signer, error) {
	b := []byte(pemKey)
	if passphrase == "" {
		return ssh.ParsePrivateKey(b)
	}
	return ssh.ParsePrivateKeyWithPassphrase(b, []byte(passphrase))
}

func (m *Manager) Exec(ctx context.Context, command string, timeoutSec int) (ExecResult, error) {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return ExecResult{}, errors.New("未连接到 SSH")
	}
	if command == "" {
		return ExecResult{}, errors.New("命令不能为空")
	}

	sess, err := c.NewSession()
	if err != nil {
		return ExecResult{}, err
	}
	defer sess.Close()

	var stdout, stderr bytes.Buffer
	sess.Stdout = &stdout
	sess.Stderr = &stderr

	start := time.Now()
	done := make(chan error, 1)
	go func() {
		done <- sess.Run(command)
	}()

	var runErr error
	if timeoutSec > 0 {
		select {
		case <-ctx.Done():
			_ = sess.Signal(ssh.SIGKILL)
			runErr = ctx.Err()
		case err := <-done:
			runErr = err
		case <-time.After(time.Duration(timeoutSec) * time.Second):
			_ = sess.Signal(ssh.SIGKILL)
			runErr = errors.New("命令执行超时")
		}
	} else {
		select {
		case <-ctx.Done():
			_ = sess.Signal(ssh.SIGKILL)
			runErr = ctx.Err()
		case err := <-done:
			runErr = err
		}
	}

	exitCode := 0
	if runErr != nil {
		var ee *ssh.ExitError
		if errors.As(runErr, &ee) {
			exitCode = ee.ExitStatus()
		} else {
			exitCode = -1
		}
	}

	res := ExecResult{
		Command:    command,
		Stdout:     stdout.String(),
		Stderr:     stderr.String(),
		ExitCode:   exitCode,
		DurationMs: time.Since(start).Milliseconds(),
	}
	return res, runErr
}

type ShellIO struct {
	In     io.WriteCloser
	Out    io.Reader
	ErrOut io.Reader
	Close  func() error
}

func (m *Manager) StartShell(term string, cols, rows int) (ShellIO, error) {
	m.mu.RLock()
	c := m.client
	m.mu.RUnlock()
	if c == nil {
		return ShellIO{}, errors.New("未连接到 SSH")
	}

	m.shellMu.Lock()
	defer m.shellMu.Unlock()
	if m.shellSess != nil {
		return ShellIO{}, errors.New("交互式 shell 已启动")
	}

	sess, err := c.NewSession()
	if err != nil {
		return ShellIO{}, err
	}

	if term == "" {
		term = "xterm-256color"
	}
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty(term, rows, cols, modes); err != nil {
		_ = sess.Close()
		return ShellIO{}, err
	}

	in, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		return ShellIO{}, err
	}
	out, err := sess.StdoutPipe()
	if err != nil {
		_ = in.Close()
		_ = sess.Close()
		return ShellIO{}, err
	}
	errOut, err := sess.StderrPipe()
	if err != nil {
		_ = in.Close()
		_ = sess.Close()
		return ShellIO{}, err
	}

	if err := sess.Shell(); err != nil {
		_ = in.Close()
		_ = sess.Close()
		return ShellIO{}, err
	}

	m.shellSess = sess
	m.shellIn = in
	m.shellOut = out
	m.shellErrOut = errOut

	return ShellIO{
		In:     in,
		Out:    out,
		ErrOut: errOut,
		Close: func() error {
			m.shellMu.Lock()
			defer m.shellMu.Unlock()
			if m.shellSess == nil {
				return nil
			}
			_ = m.shellSess.Close()
			m.shellSess = nil
			if m.shellIn != nil {
				_ = m.shellIn.Close()
				m.shellIn = nil
			}
			m.shellOut = nil
			m.shellErrOut = nil
			return nil
		},
	}, nil
}

func (m *Manager) ShellWrite(p []byte) error {
	m.shellMu.Lock()
	defer m.shellMu.Unlock()
	if m.shellIn == nil {
		return errors.New("交互式 shell 未启动")
	}
	_, err := m.shellIn.Write(p)
	return err
}

func (m *Manager) ShellResize(cols, rows int) error {
	m.shellMu.Lock()
	defer m.shellMu.Unlock()
	if m.shellSess == nil {
		return errors.New("交互式 shell 未启动")
	}
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return m.shellSess.WindowChange(rows, cols)
}

