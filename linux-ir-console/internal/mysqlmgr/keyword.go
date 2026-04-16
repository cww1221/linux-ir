package mysqlmgr

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

var systemSchemas = map[string]struct{}{
	"information_schema": {},
	"mysql":              {},
	"performance_schema": {},
	"sys":                {},
}

// KeywordHit 单表关键字命中结果。
type KeywordHit struct {
	Database   string     `json:"database"`
	Table      string     `json:"table"`
	SQL        string     `json:"sql,omitempty"`
	Columns    []string   `json:"columns,omitempty"`
	Rows       [][]string `json:"rows,omitempty"`
	Truncated  bool       `json:"truncated,omitempty"`
	RowCount   int        `json:"rowCount"`
	SkipReason string     `json:"skipReason,omitempty"`
	Error      string     `json:"error,omitempty"`
}

// KeywordSearchResponse 关键字搜索结果。
type KeywordSearchResponse struct {
	Hits          []KeywordHit `json:"hits"`
	TablesScanned int          `json:"tablesScanned"`
	Message       string       `json:"message"`
}

// SearchKeyword 在指定库（或全部非系统库）的各表中用 LIKE 搜索关键字（适合找 flag{ 等）。
func SearchKeyword(db *sql.DB, schema, keyword string, maxTables, maxRowsPerTable int) (KeywordSearchResponse, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return KeywordSearchResponse{}, errors.New("关键字不能为空")
	}
	if maxTables <= 0 {
		maxTables = 120
	}
	if maxRowsPerTable <= 0 {
		maxRowsPerTable = 40
	}
	if maxRowsPerTable > 500 {
		maxRowsPerTable = 500
	}

	pattern := likeContainPattern(keyword)

	var schemas []string
	if strings.TrimSpace(schema) != "" {
		schemas = []string{strings.TrimSpace(schema)}
	} else {
		all, err := ListDatabases(db)
		if err != nil {
			return KeywordSearchResponse{}, err
		}
		for _, s := range all {
			if _, sys := systemSchemas[strings.ToLower(s)]; sys {
				continue
			}
			schemas = append(schemas, s)
		}
	}

	var hits []KeywordHit
	scanned := 0
	matched := 0

outer:
	for _, sch := range schemas {
		if _, sys := systemSchemas[strings.ToLower(sch)]; sys {
			continue
		}
		tables, err := ListTables(db, sch)
		if err != nil {
			continue
		}
		for _, tbl := range tables {
			if scanned >= maxTables {
				break outer
			}
			scanned++

			cols, err := listColumnNames(db, sch, tbl)
			if err != nil {
				hits = append(hits, KeywordHit{Database: sch, Table: tbl, SkipReason: err.Error()})
				continue
			}
			if len(cols) == 0 {
				continue
			}
			if len(cols) > 64 {
				cols = cols[:64]
			}

			q, args := buildKeywordSelectSQL(sch, tbl, cols, pattern, maxRowsPerTable)
			rows, err := db.Query(q, args...)
			if err != nil {
				hits = append(hits, KeywordHit{Database: sch, Table: tbl, SQL: q, Error: err.Error()})
				continue
			}
			colNames, err := rows.Columns()
			if err != nil {
				_ = rows.Close()
				hits = append(hits, KeywordHit{Database: sch, Table: tbl, SQL: q, Error: err.Error()})
				continue
			}
			var buf [][]string
			truncated := false
			scanFailed := false
			for rows.Next() {
				if len(buf) >= maxRowsPerTable {
					truncated = true
					break
				}
				raw := make([]interface{}, len(colNames))
				ptrs := make([]interface{}, len(colNames))
				for i := range raw {
					ptrs[i] = &raw[i]
				}
				if err := rows.Scan(ptrs...); err != nil {
					_ = rows.Close()
					hits = append(hits, KeywordHit{Database: sch, Table: tbl, SQL: q, Error: err.Error()})
					scanFailed = true
					break
				}
				line := make([]string, len(colNames))
				for i, v := range raw {
					line[i] = cellString(v)
				}
				buf = append(buf, line)
			}
			if scanFailed {
				continue
			}
			if err := rows.Err(); err != nil {
				_ = rows.Close()
				hits = append(hits, KeywordHit{Database: sch, Table: tbl, SQL: q, Error: err.Error()})
				continue
			}
			_ = rows.Close()

			if len(buf) == 0 {
				continue
			}
			hits = append(hits, KeywordHit{
				Database: sch, Table: tbl, SQL: q, Columns: colNames, Rows: buf,
				Truncated: truncated, RowCount: len(buf),
			})
			matched++
		}
	}

	msg := fmt.Sprintf("已扫描 %d 张表", scanned)
	if matched == 0 {
		msg += "，无命中行（或仅系统库/无权限）"
	} else {
		msg += fmt.Sprintf("，%d 张表含匹配行", matched)
	}
	return KeywordSearchResponse{Hits: hits, TablesScanned: scanned, Message: msg}, nil
}

func listColumnNames(db *sql.DB, schema, table string) ([]string, error) {
	rows, err := db.Query(
		`SELECT COLUMN_NAME FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		 ORDER BY ORDINAL_POSITION`,
		schema, table,
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

func escapeIdent(s string) string {
	return strings.ReplaceAll(s, "`", "``")
}

func likeContainPattern(kw string) string {
	kw = strings.ReplaceAll(kw, `\`, `\\`)
	kw = strings.ReplaceAll(kw, `%`, `\%`)
	kw = strings.ReplaceAll(kw, `_`, `\_`)
	return "%" + kw + "%"
}

func buildKeywordSelectSQL(dbName, tblName string, cols []string, pattern string, limit int) (string, []interface{}) {
	var b strings.Builder
	b.WriteString("SELECT * FROM `")
	b.WriteString(escapeIdent(dbName))
	b.WriteString("`.`")
	b.WriteString(escapeIdent(tblName))
	b.WriteString("` WHERE (")
	args := make([]interface{}, len(cols))
	for i, col := range cols {
		if i > 0 {
			b.WriteString(" OR ")
		}
		b.WriteString("CAST(`")
		b.WriteString(escapeIdent(col))
		b.WriteString("` AS CHAR(8192)) LIKE ?")
		args[i] = pattern
	}
	b.WriteString(")")
	b.WriteString(fmt.Sprintf(" LIMIT %d", limit))
	return b.String(), args
}
