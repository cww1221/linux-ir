import { useCallback, useEffect, useState } from "react";
import {
  MySQLConnect,
  MySQLDisconnect,
  MySQLIsConnected,
  MySQLListDatabases,
  MySQLListTables,
  MySQLRunSQL,
  MySQLSearchKeyword,
} from "../wailsjs/go/main/App";

type MySQLResult = {
  kind: string;
  columns?: string[];
  rows?: string[][];
  truncated?: boolean;
  rowsAffected?: number;
  lastInsertId?: number;
  error?: string;
};

type KeywordHit = {
  database: string;
  table: string;
  sql?: string;
  columns?: string[];
  rows?: string[][];
  truncated?: boolean;
  rowCount?: number;
  skipReason?: string;
  error?: string;
};

type KwSearchResponse = {
  hits: KeywordHit[];
  tablesScanned: number;
  message: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  sshConnected: boolean;
  onLog: (line: string) => void;
};

export function MySQLWorkbench({ open, onClose, sshConnected, onLog }: Props) {
  const [mode, setMode] = useState<"direct" | "ssh">("ssh");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(3306);
  const [sshMysqlAddr, setSshMysqlAddr] = useState("127.0.0.1:3306");
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");

  const [dbConnected, setDbConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  const [databases, setDatabases] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tablesOf, setTablesOf] = useState<Record<string, string[]>>({});

  const [sql, setSql] = useState("");

  const [result, setResult] = useState<MySQLResult | null>(null);
  const [maxRows, setMaxRows] = useState(500);

  const [kwKeyword, setKwKeyword] = useState("flag{");
  const [kwSchema, setKwSchema] = useState("");
  const [kwMaxTables, setKwMaxTables] = useState(120);
  const [kwMaxRows, setKwMaxRows] = useState(40);
  const [kwResponse, setKwResponse] = useState<KwSearchResponse | null>(null);

  const refreshConnected = useCallback(async () => {
    try {
      const ok = await MySQLIsConnected();
      setDbConnected(ok);
    } catch {
      setDbConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshConnected();
  }, [open, refreshConnected]);

  async function loadDatabases() {
    const list = await MySQLListDatabases();
    setDatabases(list ?? []);
  }

  async function doConnect() {
    setBusy(true);
    try {
      await MySQLConnect({
        mode,
        host: host.trim(),
        port: Number(port) || 3306,
        sshRemoteMysqlAddr: sshMysqlAddr.trim(),
        user: user.trim(),
        password,
        database: database.trim(),
      } as any);
      setDbConnected(true);
      onLog(`\n[+] MySQL 已连接 (${mode === "ssh" ? "经 SSH 隧道" : "直连"})\n`);
      await loadDatabases();
    } catch (e) {
      onLog(`\n[-] MySQL 连接失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function doDisconnect() {
    setBusy(true);
    try {
      await MySQLDisconnect();
      setDbConnected(false);
      setDatabases([]);
      setExpanded({});
      setTablesOf({});
      setResult(null);
      setKwResponse(null);
      onLog(`\n[+] MySQL 已断开\n`);
    } catch (e) {
      onLog(`\n[-] MySQL 断开失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDb(db: string) {
    const next = !expanded[db];
    setExpanded((prev) => ({ ...prev, [db]: next }));
    if (next && !tablesOf[db]) {
      try {
        const tabs = await MySQLListTables(db);
        setTablesOf((prev) => ({ ...prev, [db]: tabs ?? [] }));
      } catch (e) {
        onLog(`\n[-] 列出表失败: ${String(e)}\n`);
      }
    }
  }

  function insertTableRef(db: string, table: string) {
    const q = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT ${Math.min(maxRows, 100)};`;
    setSql(q);
    setResult(null);
    setKwResponse(null);
  }

  async function runKeywordSearch() {
    if (!kwKeyword.trim()) {
      onLog(`\n[-] 请填写关键字\n`);
      return;
    }
    setBusy(true);
    setResult(null);
    setKwResponse(null);
    try {
      const r = (await MySQLSearchKeyword({
        schema: kwSchema.trim(),
        keyword: kwKeyword.trim(),
        maxTables: kwMaxTables || 120,
        maxRowsPerTable: kwMaxRows || 40,
      } as any)) as KwSearchResponse;
      setKwResponse(r);
      onLog(`\n[+] 关键字搜索: ${r.message}\n`);
    } catch (e) {
      onLog(`\n[-] 关键字搜索失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function runSql() {
    if (!sql.trim()) return;
    setBusy(true);
    setResult(null);
    setKwResponse(null);
    try {
      const r = await MySQLRunSQL({ sql: sql.trim(), maxRows } as any);
      setResult(r);
      if (r.error) {
        onLog(`\n[-] SQL: ${r.error}\n`);
      } else if (r.kind === "exec") {
        onLog(`\n[+] 已执行 affected=${r.rowsAffected} lastInsertId=${r.lastInsertId}\n`);
      }
    } catch (e) {
      onLog(`\n[-] MySQL 执行失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="modalMask mysqlWorkbenchMask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mysqlWorkbench glass" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mysqlWorkbenchTop">
          <div>
            <strong>MySQL 工作台</strong>
            <span className="outputTitleHint">Navicat 风格 · 直连或经 SSH 隧道连靶机 MySQL</span>
          </div>
          <div className="row">
            <button type="button" className="btnMini" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="mysqlConnBar">
          <label className="mysqlMode">
            <input
              type="radio"
              name="mysqlmode"
              checked={mode === "direct"}
              onChange={() => setMode("direct")}
            />
            直连
          </label>
          <label className="mysqlMode">
            <input
              type="radio"
              name="mysqlmode"
              checked={mode === "ssh"}
              onChange={() => setMode("ssh")}
              disabled={!sshConnected}
            />
            SSH 隧道
              {!sshConnected ? <span className="hint small">（先连 SSH）</span> : null}
          </label>
          {mode === "direct" ? (
            <>
              <input
                className="mysqlInput"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="Host"
              />
              <input
                className="mysqlInput narrow"
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                placeholder="3306"
              />
            </>
          ) : (
            <input
              className="mysqlInput"
              value={sshMysqlAddr}
              onChange={(e) => setSshMysqlAddr(e.target.value)}
              placeholder="靶机 MySQL 地址(一般 127.0.0.1:3306)"
              title="SSH 登录后，在靶机上访问的 mysqld 地址"
            />
          )}
          <input
            className="mysqlInput narrow"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="用户"
          />
          <input
            className="mysqlInput narrow"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
          />
          <input
            className="mysqlInput"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="数据库（可选）"
          />
          {!dbConnected ? (
            <button type="button" className="btnMini btnAccent" disabled={busy} onClick={doConnect}>
              连接
            </button>
          ) : (
            <button type="button" className="btnMini" disabled={busy} onClick={doDisconnect}>
              断开
            </button>
          )}
          <span className={`mysqlDot ${dbConnected ? "on" : ""}`} title={dbConnected ? "已连接" : "未连接"} />
        </div>

        <div className="mysqlSplit">
          <div className="mysqlTreePane">
            <div className="mysqlTreeTitle">对象</div>
            <div className="mysqlTreeBody">
              {databases.map((db) => (
                <div key={db} className="mysqlTreeDb">
                  <button
                    type="button"
                    className="mysqlTreeDbBtn"
                    onClick={() => toggleDb(db)}
                  >
                    {expanded[db] ? "▼" : "▶"} {db}
                  </button>
                  {expanded[db] ? (
                    <div className="mysqlTreeTables">
                      {(tablesOf[db] ?? []).map((tb) => (
                        <button
                          type="button"
                          key={tb}
                          className="mysqlTreeTb"
                          onClick={() => insertTableRef(db, tb)}
                          title="用该表重写 SQL（替换编辑器内容，并清空上次结果）"
                        >
                          {tb}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="mysqlEditorPane">
            <div className="mysqlKeywordBar">
              <span className="mysqlKeywordLabel">关键字</span>
              <input
                className="mysqlInput"
                value={kwKeyword}
                onChange={(e) => setKwKeyword(e.target.value)}
                placeholder="如 flag{ 或 flag"
                disabled={busy || !dbConnected}
              />
              <span className="mysqlKeywordLabel">库</span>
              <select
                className="mysqlSelect"
                value={kwSchema}
                onChange={(e) => setKwSchema(e.target.value)}
                disabled={busy || !dbConnected}
                title="空 = 扫描全部非系统库"
              >
                <option value="">全部（非系统库）</option>
                {databases.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <label className="hint small mysqlKwNum">
                最多表
                <input
                  type="number"
                  className="mysqlInput tiny"
                  value={kwMaxTables}
                  onChange={(e) => setKwMaxTables(Number(e.target.value) || 120)}
                  min={1}
                  max={500}
                  disabled={busy || !dbConnected}
                />
              </label>
              <label className="hint small mysqlKwNum">
                每表行
                <input
                  type="number"
                  className="mysqlInput tiny"
                  value={kwMaxRows}
                  onChange={(e) => setKwMaxRows(Number(e.target.value) || 40)}
                  min={1}
                  max={500}
                  disabled={busy || !dbConnected}
                />
              </label>
              <button
                type="button"
                className="btnMini btnAccent"
                disabled={busy || !dbConnected}
                onClick={runKeywordSearch}
              >
                搜索关键字
              </button>
            </div>
            <div className="mysqlSqlBar">
              <span>SQL</span>
              <label className="hint small">
                行数上限
                <input
                  type="number"
                  className="mysqlInput tiny"
                  value={maxRows}
                  onChange={(e) => setMaxRows(Number(e.target.value) || 500)}
                  min={1}
                  max={10000}
                />
              </label>
              <button type="button" className="btnMini btnAccent" disabled={busy || !dbConnected} onClick={runSql}>
                运行 (Ctrl+Enter)
              </button>
            </div>
            <textarea
              className="mysqlSqlArea"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === "Enter") {
                  e.preventDefault();
                  runSql();
                }
              }}
              spellCheck={false}
              placeholder="输入 SQL，Ctrl+Enter 执行；左侧点击表名将替换为本内容并清空上次结果"
            />
            <div className="mysqlResultWrap">
              <div className="mysqlResultBlockTitle">查询结果</div>
              <MySQLResultView result={result} />
            </div>
            <div className="mysqlKwResultWrap">
              <div className="mysqlResultBlockTitle">关键字搜索</div>
              <KeywordHitsView data={kwResponse} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KeywordHitsView({ data }: { data: KwSearchResponse | null }) {
  if (!data) {
    return <p className="hint small">在上方输入关键字，点击「搜索关键字」跨表 LIKE 查找（适合找 flag）</p>;
  }
  return (
    <div className="mysqlKwHits">
      <p className="hint small mysqlKwMsg">{data.message}</p>
      {data.hits.length === 0 ? (
        <p className="hint small">无命中</p>
      ) : (
        data.hits.map((h, i) => (
          <div key={`${h.database}.${h.table}.${i}`} className="mysqlKwHit">
            <div className="mysqlKwHitTitle">
              <code>
                {h.database}.{h.table}
              </code>
              {h.rowCount != null ? <span className="outputTitleHint"> · {h.rowCount} 行</span> : null}
              {h.truncated ? <span className="outputTitleHint"> · 已截断</span> : null}
            </div>
            {h.error ? <pre className="mysqlErr">{h.error}</pre> : null}
            {h.skipReason ? <p className="hint small">{h.skipReason}</p> : null}
            {h.sql && (h.error || h.skipReason) ? (
              <pre className="outputTitleHint mono">{h.sql}</pre>
            ) : null}
            {h.columns && h.rows && h.rows.length > 0 ? (
              <div className="mysqlTableScroll">
                {h.truncated ? <p className="hint small">仅显示前若干行</p> : null}
                <table className="mysqlGrid">
                  <thead>
                    <tr>
                      {(h.columns ?? []).map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(h.rows ?? []).map((line, ri) => (
                      <tr key={ri}>
                        {line.map((cell, ci) => (
                          <td key={ci}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

function MySQLResultView({ result }: { result: MySQLResult | null }) {
  if (!result) {
    return <p className="hint small">无结果</p>;
  }
  if (result.error) {
    return <pre className="mysqlErr">{result.error}</pre>;
  }
  if (result.kind === "exec") {
    return (
      <p className="hint small">
        已执行 · rowsAffected={result.rowsAffected ?? 0} · lastInsertId={result.lastInsertId ?? 0}
      </p>
    );
  }
  const cols = result.columns ?? [];
  const rows = result.rows ?? [];
  return (
    <div className="mysqlTableScroll">
      {result.truncated ? <p className="hint small">结果已截断（行数上限）</p> : null}
      <table className="mysqlGrid">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((line, i) => (
            <tr key={i}>
              {line.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
