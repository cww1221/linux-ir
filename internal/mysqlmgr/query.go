package mysqlmgr

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

// ListDatabases 返回可访问的数据库名列表。
func ListDatabases(db *sql.DB) ([]string, error) {
	rows, err := db.Query("SHOW DATABASES")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// ListTables 列出指定库中的表名。
func ListTables(db *sql.DB, schema string) ([]string, error) {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		return nil, errors.New("数据库名不能为空")
	}
	rows, err := db.Query(
		"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
		schema,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	return out, rows.Err()
}

// Result 为 JSON 友好的查询/执行结果。
type Result struct {
	Kind         string     `json:"kind"` // rows | exec
	Columns      []string   `json:"columns,omitempty"`
	Rows         [][]string `json:"rows,omitempty"`
	Truncated    bool       `json:"truncated,omitempty"`
	RowsAffected int64      `json:"rowsAffected,omitempty"`
	LastInsertID int64      `json:"lastInsertId,omitempty"`
	Error        string     `json:"error,omitempty"`
}

// RunSQL 执行单条 SQL；返回行集或执行影响行数。
func RunSQL(db *sql.DB, sqlStr string, maxRows int) Result {
	sqlStr = strings.TrimSpace(sqlStr)
	if sqlStr == "" {
		return Result{Kind: "exec", Error: "SQL 为空"}
	}
	if maxRows <= 0 {
		maxRows = 500
	}
	if maxRows > 10000 {
		maxRows = 10000
	}

	if isRowReturningSQL(sqlStr) {
		rows, err := db.Query(sqlStr)
		if err != nil {
			return Result{Kind: "rows", Error: err.Error()}
		}
		defer rows.Close()
		cols, err := rows.Columns()
		if err != nil {
			return Result{Kind: "rows", Error: err.Error()}
		}
		var buf [][]string
		n := 0
		for rows.Next() {
			if n >= maxRows {
				return Result{Kind: "rows", Columns: cols, Rows: buf, Truncated: true}
			}
			raw := make([]interface{}, len(cols))
			ptrs := make([]interface{}, len(cols))
			for i := range raw {
				ptrs[i] = &raw[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				return Result{Kind: "rows", Columns: cols, Rows: buf, Error: err.Error()}
			}
			line := make([]string, len(cols))
			for i, v := range raw {
				line[i] = cellString(v)
			}
			buf = append(buf, line)
			n++
		}
		if err := rows.Err(); err != nil {
			return Result{Kind: "rows", Columns: cols, Rows: buf, Error: err.Error()}
		}
		return Result{Kind: "rows", Columns: cols, Rows: buf}
	}

	res, err := db.Exec(sqlStr)
	if err != nil {
		return Result{Kind: "exec", Error: err.Error()}
	}
	ra, _ := res.RowsAffected()
	li, _ := res.LastInsertId()
	return Result{Kind: "exec", RowsAffected: ra, LastInsertID: li}
}

func isRowReturningSQL(s string) bool {
	u := strings.ToUpper(strings.TrimSpace(s))
	for _, p := range []string{"SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH"} {
		if u == p || strings.HasPrefix(u, p+" ") || strings.HasPrefix(u, p+"\t") || strings.HasPrefix(u, p+"\n") {
			return true
		}
	}
	return false
}

func cellString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case []byte:
		return string(t)
	default:
		return stringifyJSON(t)
	}
}

func stringifyJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	s := string(b)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}
