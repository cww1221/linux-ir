package main

import (
	"errors"
	"strings"

	"linux-ir-console/internal/mysqlmgr"
)

// MySQLConnectRequest 连接 MySQL。Mode=direct 时填写 Host/Port；Mode=ssh 时先建立 SSH，再连靶机上的 MySQL（默认 127.0.0.1:3306）。
type MySQLConnectRequest struct {
	Mode string `json:"mode"` // direct | ssh

	Host string `json:"host"` // direct 必填
	Port int    `json:"port"` // 默认 3306

	// ssh 模式下远端 mysqld 地址（一般为靶机本机）
	SSHRemoteMySQLAddr string `json:"sshRemoteMysqlAddr"`

	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"` // 可选
}

func (a *App) MySQLConnect(req MySQLConnectRequest) error {
	a.mysqlMu.Lock()
	defer a.mysqlMu.Unlock()

	if a.mysqlDB != nil {
		mysqlmgr.Close(a.mysqlDB, a.mysqlOverSSH)
		a.mysqlDB = nil
		a.mysqlOverSSH = false
	}

	user := strings.TrimSpace(req.User)
	if user == "" {
		return errors.New("MySQL 用户名不能为空")
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "direct"
	}

	switch mode {
	case "direct":
		host := strings.TrimSpace(req.Host)
		if host == "" {
			return errors.New("直连模式需要填写 Host")
		}
		db, err := mysqlmgr.OpenDirect(host, req.Port, user, req.Password, strings.TrimSpace(req.Database))
		if err != nil {
			return err
		}
		a.mysqlDB = db
		a.mysqlOverSSH = false
		return nil
	case "ssh":
		a.sshMu.Lock()
		ssh := a.ssh
		a.sshMu.Unlock()
		if ssh == nil || !ssh.IsConnected() {
			return errors.New("请先连接 SSH")
		}
		addr := strings.TrimSpace(req.SSHRemoteMySQLAddr)
		if addr == "" {
			addr = "127.0.0.1:3306"
		}
		db, err := mysqlmgr.OpenOverSSH(ssh, addr, user, req.Password, strings.TrimSpace(req.Database))
		if err != nil {
			return err
		}
		a.mysqlDB = db
		a.mysqlOverSSH = true
		return nil
	default:
		return errors.New("mode 仅支持 direct 或 ssh")
	}
}

func (a *App) MySQLDisconnect() error {
	a.mysqlMu.Lock()
	defer a.mysqlMu.Unlock()
	if a.mysqlDB == nil {
		return nil
	}
	mysqlmgr.Close(a.mysqlDB, a.mysqlOverSSH)
	a.mysqlDB = nil
	a.mysqlOverSSH = false
	return nil
}

func (a *App) MySQLIsConnected() bool {
	a.mysqlMu.Lock()
	defer a.mysqlMu.Unlock()
	return a.mysqlDB != nil
}

func (a *App) MySQLListDatabases() ([]string, error) {
	a.mysqlMu.Lock()
	db := a.mysqlDB
	a.mysqlMu.Unlock()
	if db == nil {
		return nil, errors.New("MySQL 未连接")
	}
	return mysqlmgr.ListDatabases(db)
}

func (a *App) MySQLListTables(schema string) ([]string, error) {
	a.mysqlMu.Lock()
	db := a.mysqlDB
	a.mysqlMu.Unlock()
	if db == nil {
		return nil, errors.New("MySQL 未连接")
	}
	return mysqlmgr.ListTables(db, schema)
}

// MySQLRunRequest 执行单条 SQL。
type MySQLRunRequest struct {
	SQL     string `json:"sql"`
	MaxRows int    `json:"maxRows"`
}

func (a *App) MySQLRunSQL(req MySQLRunRequest) (mysqlmgr.Result, error) {
	a.mysqlMu.Lock()
	db := a.mysqlDB
	a.mysqlMu.Unlock()
	if db == nil {
		return mysqlmgr.Result{}, errors.New("MySQL 未连接")
	}
	r := mysqlmgr.RunSQL(db, req.SQL, req.MaxRows)
	return r, nil
}

// MySQLKeywordSearchRequest 跨表关键字搜索（LIKE，用于 flag 等）。
type MySQLKeywordSearchRequest struct {
	Schema          string `json:"schema"` // 空 = 全部非系统库
	Keyword         string `json:"keyword"`
	MaxTables       int    `json:"maxTables"`
	MaxRowsPerTable int    `json:"maxRowsPerTable"`
}

func (a *App) MySQLSearchKeyword(req MySQLKeywordSearchRequest) (mysqlmgr.KeywordSearchResponse, error) {
	a.mysqlMu.Lock()
	db := a.mysqlDB
	a.mysqlMu.Unlock()
	if db == nil {
		return mysqlmgr.KeywordSearchResponse{}, errors.New("MySQL 未连接")
	}
	return mysqlmgr.SearchKeyword(db, req.Schema, req.Keyword, req.MaxTables, req.MaxRowsPerTable)
}
