package mysqlmgr

import (
	"context"
	"database/sql"
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-sql-driver/mysql"

	sshx "linux-ir-console/internal/ssh"
)

const sshDialNet = "ir_mysql_ssh"

var (
	sshDialMu     sync.Mutex
	sshDialTarget *sshx.Manager
)

func init() {
	mysql.RegisterDialContext(sshDialNet, func(ctx context.Context, addr string) (net.Conn, error) {
		sshDialMu.Lock()
		m := sshDialTarget
		sshDialMu.Unlock()
		if m == nil {
			return nil, errors.New("MySQL SSH 隧道未就绪")
		}
		return m.DialTCP(addr)
	})
}

func setSSHDialTarget(m *sshx.Manager) {
	sshDialMu.Lock()
	sshDialTarget = m
	sshDialMu.Unlock()
}

func clearSSHDialTarget() {
	sshDialMu.Lock()
	sshDialTarget = nil
	sshDialMu.Unlock()
}

// OpenDirect 直连 MySQL（host:port）。
func OpenDirect(host string, port int, user, passwd, dbname string) (*sql.DB, error) {
	cfg := mysql.NewConfig()
	cfg.User = user
	cfg.Passwd = passwd
	cfg.Net = "tcp"
	if port <= 0 {
		port = 3306
	}
	cfg.Addr = net.JoinHostPort(host, strconv.Itoa(port))
	cfg.DBName = dbname
	cfg.ParseTime = true
	cfg.Loc = time.Local
	cfg.Params = map[string]string{"charset": "utf8mb4"}
	connector, err := mysql.NewConnector(cfg)
	if err != nil {
		return nil, err
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// OpenOverSSH 通过已有 SSH 会话连接远端 MySQL（remoteAddr 一般为 127.0.0.1:3306）。
func OpenOverSSH(sshMgr *sshx.Manager, remoteAddr, user, passwd, dbname string) (*sql.DB, error) {
	if sshMgr == nil {
		return nil, errors.New("SSH 未连接")
	}
	if strings.TrimSpace(remoteAddr) == "" {
		remoteAddr = "127.0.0.1:3306"
	}
	setSSHDialTarget(sshMgr)
	cfg := mysql.NewConfig()
	cfg.User = user
	cfg.Passwd = passwd
	cfg.Net = sshDialNet
	cfg.Addr = remoteAddr
	cfg.DBName = dbname
	cfg.ParseTime = true
	cfg.Loc = time.Local
	cfg.Params = map[string]string{"charset": "utf8mb4"}
	connector, err := mysql.NewConnector(cfg)
	if err != nil {
		clearSSHDialTarget()
		return nil, err
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		clearSSHDialTarget()
		return nil, err
	}
	return db, nil
}

// Close 关闭连接；若 overSSH 为 true 会释放 SSH 隧道 dial 绑定。
func Close(db *sql.DB, overSSH bool) {
	if db != nil {
		_ = db.Close()
	}
	if overSSH {
		clearSSHDialTarget()
	}
}
