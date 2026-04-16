package main

import (
	"context"
	"database/sql"
	"errors"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"linux-ir-console/internal/playbook"
	sshx "linux-ir-console/internal/ssh"
)

// App struct
type App struct {
	ctx context.Context

	sshMu sync.Mutex
	ssh   *sshx.Manager

	mysqlMu      sync.Mutex
	mysqlDB      *sql.DB
	mysqlOverSSH bool

	pb playbook.Catalog
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		ssh: &sshx.Manager{},
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	cat, err := playbook.LoadEmbeddedCatalog()
	if err == nil {
		a.pb = cat
	}
}

type ConnectConfig = sshx.ConnectConfig
type ExecResult = sshx.ExecResult

type ExecRequest struct {
	Command    string            `json:"command"`
	TimeoutSec int               `json:"timeoutSec"`
	Vars       map[string]string `json:"vars"`
}

type RunItemRequest struct {
	ItemID string            `json:"itemId"`
	Vars   map[string]string `json:"vars"`
}

func (a *App) GetPlaybookCatalog() playbook.Catalog {
	return a.pb
}

func (a *App) SSHConnect(cfg ConnectConfig) error {
	a.sshMu.Lock()
	defer a.sshMu.Unlock()
	return a.ssh.Connect(cfg)
}

func (a *App) SSHDisconnect() error {
	a.sshMu.Lock()
	defer a.sshMu.Unlock()
	return a.ssh.Disconnect()
}

func (a *App) SSHIsConnected() bool {
	return a.ssh.IsConnected()
}

func (a *App) SSHExec(req ExecRequest) (ExecResult, error) {
	cmd := req.Command
	if cmd == "" {
		return ExecResult{}, errors.New("command 不能为空")
	}
	return a.ssh.Exec(a.ctx, cmd, req.TimeoutSec)
}

func (a *App) RunPlaybookItem(req RunItemRequest) (ExecResult, error) {
	it, ok := a.pb.FindByID(req.ItemID)
	if !ok {
		return ExecResult{}, errors.New("未找到检查项: " + req.ItemID)
	}
	cmd, err := playbook.RenderCommand(it, req.Vars)
	if err != nil {
		return ExecResult{}, err
	}
	return a.ssh.Exec(a.ctx, cmd, it.TimeoutSec)
}

type StartShellRequest struct {
	Term string `json:"term"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (a *App) SSHStartShell(req StartShellRequest) error {
	io, err := a.ssh.StartShell(req.Term, req.Cols, req.Rows)
	if err != nil {
		return err
	}

	// stdout
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, rerr := io.Out.Read(buf)
			if n > 0 {
				runtime.EventsEmit(a.ctx, "shell:data", string(buf[:n]))
			}
			if rerr != nil {
				runtime.EventsEmit(a.ctx, "shell:close", "stdout closed")
				return
			}
		}
	}()
	// stderr
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, rerr := io.ErrOut.Read(buf)
			if n > 0 {
				runtime.EventsEmit(a.ctx, "shell:data", string(buf[:n]))
			}
			if rerr != nil {
				return
			}
		}
	}()

	return nil
}

func (a *App) SSHShellWrite(data string) error {
	if data == "" {
		return nil
	}
	return a.ssh.ShellWrite([]byte(data))
}

func (a *App) SSHShellResize(cols, rows int) error {
	return a.ssh.ShellResize(cols, rows)
}
