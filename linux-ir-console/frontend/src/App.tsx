import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { CyberBackground } from "./CyberBackground";
import { MySQLWorkbench } from "./MySQLWorkbench";
import { extractFlagsFromText } from "./flagUtils";
import { TaskOutputHighlight } from "./TaskOutputHighlight";
import {
  GetPlaybookCatalog,
  RunPlaybookItem,
  GetSettings,
  SaveSettings,
  ListOllamaModels,
  SFTPListDir,
  SFTPDownloadDialog,
  SFTPUploadDialog,
  SFTPReadText,
  SFTPWriteText,
  LocalListDir,
  LocalReadText,
  LocalWriteText,
  CrackShadowHash,
  CrackShadowPickWordlist,
  StartLocalForward,
  StopLocalForward,
  AIChat,
  AIToolExecute,
  SSHConnect,
  SSHDisconnect,
  SSHExec,
  SSHIsConnected,
  SSHGuardAnalysis,
  SSHSearchFlags,
  SSHGrepRecursive,
  SSHShellResize,
  SSHShellWrite,
  SSHSignalPids,
  SSHStartShell,
} from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type PlaybookItem = {
  id: string;
  name: string;
  category: string;
  command: string;
  timeoutSec: number;
  needsRoot: boolean;
  description: string;
  tags: string[];
  vars: Record<string, string>;
  remediateId?: string;
};

type PlaybookDoc = {
  version: string;
  title: string;
  items: PlaybookItem[];
};

type Catalog = { docs: PlaybookDoc[] };

function App() {
  const [connected, setConnected] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("矿码检测");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [webRoot, setWebRoot] = useState<string>("/var/www");

  const [output, setOutput] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Settings (AI/并发)
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [aiProvider, setAiProvider] = useState<"none" | "ollama" | "openai_compatible">("ollama");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("https://api.openai.com/v1");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4.1-mini");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  // SFTP
  const [sftpPath, setSftpPath] = useState<string>("/root");
  const [sftpEntries, setSftpEntries] = useState<
    { name: string; path: string; size: number; mode: string; mtime: number; isDir: boolean }[]
  >([]);

  // XFTP 风格 SFTP 管理器
  const [sftpMgrOpen, setSftpMgrOpen] = useState(false);
  const [localPath, setLocalPath] = useState<string>(() => localStorage.getItem("ui.localPath") ?? "");
  const [localEntries, setLocalEntries] = useState<
    { name: string; path: string; size: number; mode: string; mtime: number; isDir: boolean }[]
  >([]);
  const [remotePath, setRemotePath] = useState<string>("/root");
  const [remoteEntries, setRemoteEntries] = useState<
    { name: string; path: string; size: number; mode: string; mtime: number; isDir: boolean }[]
  >([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editPath, setEditPath] = useState("");
  const [editKind, setEditKind] = useState<"local" | "remote">("remote");
  const [editText, setEditText] = useState("");
  const [editDirty, setEditDirty] = useState(false);

  // 离线校验/修复（上传包到远端）
  const [offlinePkgDir, setOfflinePkgDir] = useState("/tmp/ir-packages");
  const [offlinePkgPath, setOfflinePkgPath] = useState("/tmp/ir-packages/coreutils.deb");
  const [offlineForceNodeps, setOfflineForceNodeps] = useState(false);

  // Shadow crypt：词表验证（无法从哈希反推明文）
  const [shadowCrackInput, setShadowCrackInput] = useState("");
  const [shadowCrackInline, setShadowCrackInline] = useState("");
  const [shadowCrackWordlist, setShadowCrackWordlist] = useState("");
  const [shadowCrackProgress, setShadowCrackProgress] = useState<number | null>(null);
  const [shadowCrackBusy, setShadowCrackBusy] = useState(false);

  // Local forward
  const [fwdListen, setFwdListen] = useState("127.0.0.1:18080");
  const [fwdRemote, setFwdRemote] = useState("127.0.0.1:80");
  const [forwardId, setForwardId] = useState<string>("");

  const [mysqlWorkbenchOpen, setMysqlWorkbenchOpen] = useState(false);

  // AI Chat
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatToolLog, setChatToolLog] = useState("");
  const [chatPending, setChatPending] = useState<{
    name: string;
    args: Record<string, any>;
    risk: string;
    reason: string;
  } | null>(null);

  const [flagInput, setFlagInput] = useState("");
  const [flagLoose, setFlagLoose] = useState(false);
  const [flagHits, setFlagHits] = useState<string[]>([]);

  const [fsPaths, setFsPaths] = useState("/tmp\n/var/tmp");
  const [fsNameKw, setFsNameKw] = useState("");
  const [fsContentKw, setFsContentKw] = useState("flag{");
  const [fsMaxDepth, setFsMaxDepth] = useState(6);
  const [fsMaxMatch, setFsMaxMatch] = useState(120);

  /** grep -rni：单目录 + 关键字 */
  const [fsGrepRoot, setFsGrepRoot] = useState("/var/www");
  const [fsGrepKw, setFsGrepKw] = useState("flag{");
  const [fsGrepMaxLines, setFsGrepMaxLines] = useState(500);
  const [fsGrepUseRegex, setFsGrepUseRegex] = useState(false);

  const [minePidInput, setMinePidInput] = useState("");
  const [mineSignal, setMineSignal] = useState<15 | 9>(15);
  const [mineConfirm, setMineConfirm] = useState(false);
  const [guardPath, setGuardPath] = useState("");

  const termDivRef = useRef<HTMLDivElement | null>(null);
  const termWrapRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // 右侧上下分割：终端高度可拖拽调整（像 IDE 一样）
  const [termHeight, setTermHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem("ui.termHeight") ?? "");
    return Number.isFinite(v) && v >= 220 ? v : 360;
  });
  const draggingRef = useRef<{ startY: number; startH: number } | null>(null);

  const allItems = useMemo(() => {
    const items: PlaybookItem[] = [];
    for (const d of catalog?.docs ?? []) items.push(...(d.items ?? []));
    return items;
  }, [catalog]);

  const selectedItem = useMemo(
    () => allItems.find((x) => x.id === selectedItemId) ?? null,
    [allItems, selectedItemId]
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of allItems) if (it.category) set.add(it.category);
    return Array.from(set).sort();
  }, [allItems]);

  const itemsInCategory = useMemo(
    () => allItems.filter((x) => x.category === selectedCategory),
    [allItems, selectedCategory]
  );

  useEffect(() => {
    GetPlaybookCatalog()
      .then((c) => setCatalog(c as Catalog))
      .catch((e) => setOutput((p) => p + `\n[GetPlaybookCatalog] ${String(e)}\n`));
    SSHIsConnected().then(setConnected).catch(() => {});

    GetSettings()
      .then((s: any) => {
        setAiProvider((s.aiProvider ?? "ollama") as any);
        setOllamaBaseUrl(String(s.ollamaBaseUrl ?? "http://127.0.0.1:11434"));
        setOllamaModel(String(s.ollamaModel ?? ""));
        setOpenaiBaseUrl(String(s.openaiBaseUrl ?? "https://api.openai.com/v1"));
        setOpenaiApiKey(String(s.openaiApiKey ?? ""));
        setOpenaiModel(String(s.openaiModel ?? "gpt-4.1-mini"));
        setSettingsLoaded(true);
      })
      .catch((e) => setOutput((p) => p + `\n[GetSettings] ${String(e)}\n`));
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = EventsOn("shadowcrack:progress", (p: unknown) => {
        const o = p as { attempts?: number };
        if (typeof o?.attempts === "number") setShadowCrackProgress(o.attempts);
      });
    } catch {
      /* ignore */
    }
    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    if (!termDivRef.current) return;
    if (termRef.current) return;

    const term = new Terminal({
      convertEol: true,
      fontFamily: "Consolas, Menlo, Monaco, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#070d18",
        foreground: "#e5e7eb",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(termDivRef.current);
    fit.fit();
    requestAnimationFrame(() => fit.fit());
    setTimeout(() => fit.fit(), 80);

    term.onData((data) => {
      SSHShellWrite(data).catch(() => {});
    });

    // 复制/粘贴（不占用 Ctrl+C，避免和 SIGINT 冲突）
    // - Ctrl+Shift+C: 复制选中
    // - Ctrl+Shift+V: 读取剪贴板并粘贴到终端
    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      const code = (ev as any).code as string | undefined;
      if (ev.ctrlKey && ev.shiftKey && code === "KeyC") {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        ev.preventDefault();
        return false;
      }
      if (ev.ctrlKey && ev.shiftKey && code === "KeyV") {
        navigator.clipboard
          .readText()
          .then((t) => (t ? SSHShellWrite(t) : Promise.resolve()))
          .catch(() => {});
        ev.preventDefault();
        return false;
      }
      return true;
    });
    // 右键：有选中就复制，否则粘贴
    try {
      term.element?.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
        } else {
          navigator.clipboard
            .readText()
            .then((t) => (t ? SSHShellWrite(t) : Promise.resolve()))
            .catch(() => {});
        }
      });
    } catch {
      /* ignore */
    }

    termRef.current = term;
    fitRef.current = fit;

    let offData: (() => void) | undefined;
    let offClose: (() => void) | undefined;
    try {
      offData = EventsOn("shell:data", (chunk: unknown) => {
        term.write(typeof chunk === "string" ? chunk : String(chunk));
      });
      offClose = EventsOn("shell:close", (msg: unknown) => {
        term.writeln(`\r\n[shell closed] ${String(msg ?? "")}\r\n`);
      });
    } catch (e) {
      console.error("[shell events]", e);
    }

    const onResize = () => {
      try {
        fit.fit();
        const cols = term.cols;
        const rows = term.rows;
        SSHShellResize(cols, rows).catch(() => {});
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      try {
        offData?.();
        offClose?.();
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("ui.termHeight", String(termHeight));
    // 拖拽时及时 fit，避免 xterm 留白
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (term) SSHShellResize(term.cols, term.rows).catch(() => {});
      } catch {
        /* ignore */
      }
    });
  }, [termHeight]);

  function onSplitterPointerDown(e: React.PointerEvent) {
    draggingRef.current = { startY: e.clientY, startH: termHeight };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }
  function onSplitterPointerMove(e: React.PointerEvent) {
    const d = draggingRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const next = d.startH + dy;
    // 约束：终端不低于 220，不高于 main 可视高度的 80%
    const max = Math.floor(Math.max(260, window.innerHeight * 0.8));
    setTermHeight(Math.max(220, Math.min(max, next)));
  }
  function onSplitterPointerUp() {
    draggingRef.current = null;
  }

  async function doConnect() {
    setBusy(true);
    try {
      await SSHConnect({
        host,
        port,
        username,
        auth: { password, privateKey: "", passphrase: "" },
        dialTimeout: 10,
      } as any);
      setConnected(true);
      setOutput((p) => p + `\n[+] SSH 连接成功: ${username}@${host}:${port}\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] SSH 连接失败: ${String(e)}\n`);
      setConnected(false);
    } finally {
      setBusy(false);
    }
  }

  async function doDisconnect() {
    setBusy(true);
    try {
      await SSHDisconnect();
      setConnected(false);
      setOutput((p) => p + `\n[+] 已断开连接\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 断开失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshOllama() {
    setBusy(true);
    try {
      const models = await ListOllamaModels(ollamaBaseUrl);
      setOllamaModels((models as any) ?? []);
      if (!ollamaModel && Array.isArray(models) && models.length) setOllamaModel(models[0]);
      setOutput((p) => p + `\n[+] Ollama 模型已刷新，共 ${Array.isArray(models) ? models.length : 0} 个\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 刷新 Ollama 失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      await SaveSettings({
        aiProvider,
        ollamaBaseUrl,
        ollamaModel,
        openaiBaseUrl,
        openaiApiKey,
        openaiModel,
        maxParallelExec: 10,
      } as any);
      setOutput((p) => p + `\n[+] 设置已保存\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 保存设置失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function sftpRefresh() {
    if (!connected) return;
    setBusy(true);
    try {
      const list = await SFTPListDir(sftpPath);
      setSftpEntries((list as any) ?? []);
      setOutput((p) => p + `\n[+] SFTP 列表刷新: ${sftpPath}\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] SFTP 刷新失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshLocal(p?: string) {
    const path = (p ?? localPath).trim() || ".";
    setBusy(true);
    try {
      const list = await LocalListDir(path);
      setLocalEntries((list as any) ?? []);
      setLocalPath(path);
      localStorage.setItem("ui.localPath", path);
    } catch (e: unknown) {
      setOutput((x) => x + `\n[-] 本地目录读取失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshRemote(p?: string) {
    const path = (p ?? remotePath).trim() || ".";
    setBusy(true);
    try {
      const list = await SFTPListDir(path);
      setRemoteEntries((list as any) ?? []);
      setRemotePath(path);
    } catch (e: unknown) {
      setOutput((x) => x + `\n[-] 远端目录读取失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function openRemoteEditor(p: string) {
    setBusy(true);
    try {
      const txt = await SFTPReadText(p, 2 * 1024 * 1024);
      setEditKind("remote");
      setEditPath(p);
      setEditText(String(txt ?? ""));
      setEditDirty(false);
      setEditOpen(true);
    } catch (e: unknown) {
      setOutput((x) => x + `\n[-] 打开远端文件失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function openLocalEditor(p: string) {
    setBusy(true);
    try {
      const txt = await LocalReadText(p, 2 * 1024 * 1024);
      setEditKind("local");
      setEditPath(p);
      setEditText(String(txt ?? ""));
      setEditDirty(false);
      setEditOpen(true);
    } catch (e: unknown) {
      setOutput((x) => x + `\n[-] 打开本地文件失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function saveEditor() {
    if (!editPath) return;
    setBusy(true);
    try {
      if (editKind === "remote") {
        await SFTPWriteText(editPath, editText);
        setOutput((x) => x + `\n[+] 已保存远端文件: ${editPath}\n`);
        await refreshRemote();
      } else {
        await LocalWriteText(editPath, editText);
        setOutput((x) => x + `\n[+] 已保存本地文件: ${editPath}\n`);
        await refreshLocal();
      }
      setEditDirty(false);
    } catch (e: unknown) {
      setOutput((x) => x + `\n[-] 保存失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  function sftpUp() {
    const p = sftpPath.trim();
    if (!p || p === "/" || p === ".") return;
    const up = p.replace(/\/+$/, "");
    const idx = up.lastIndexOf("/");
    setSftpPath(idx <= 0 ? "/" : up.slice(0, idx));
  }

  async function sftpDownload(path: string) {
    if (!connected) return;
    setBusy(true);
    try {
      await SFTPDownloadDialog(path);
      setOutput((p) => p + `\n[+] 下载完成: ${path}\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 下载失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function sftpUpload() {
    if (!connected) return;
    setBusy(true);
    try {
      await SFTPUploadDialog(sftpPath);
      setOutput((p) => p + `\n[+] 上传完成 -> ${sftpPath}\n`);
      await sftpRefresh();
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 上传失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function offlineUploadPkg() {
    if (!connected) return;
    setBusy(true);
    try {
      await SFTPUploadDialog(offlinePkgDir.trim() || "/tmp/ir-packages");
      setOutput((p) => p + `\n[+] 离线包已上传 -> ${offlinePkgDir.trim() || "/tmp/ir-packages"}\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 上传离线包失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function offlineVerify() {
    if (!connected) return;
    setBusy(true);
    try {
      const res = await RunPlaybookItem({ itemId: "integrity.verify_pkgdb", vars: {} } as any);
      setOutput((p) => p + `\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 离线校验失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function offlineInstallPkg() {
    if (!connected) return;
    const pkg = offlinePkgPath.trim();
    if (!pkg) return;
    setBusy(true);
    try {
      const vars: Record<string, string> = {
        PkgPath: pkg,
        ForceNodeps: offlineForceNodeps ? "true" : "false",
      };
      const res = await RunPlaybookItem({ itemId: "integrity.offline_install_pkg", vars } as any);
      setOutput((p) => p + `\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 离线修复失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function pickShadowWordlist() {
    try {
      const p = await CrackShadowPickWordlist();
      if (p) setShadowCrackWordlist(p);
    } catch (e: unknown) {
      setOutput((x) => x + `\n[-] 选择词表失败: ${String(e)}\n`);
    }
  }

  async function runShadowCrack() {
    if (!shadowCrackInput.trim()) {
      setOutput((x) => x + "\n[-] 请粘贴 /etc/shadow 一行或单独的 $1$/$5$/$6$ 哈希\n");
      return;
    }
    setShadowCrackBusy(true);
    setShadowCrackProgress(0);
    try {
      const r = (await CrackShadowHash({
        input: shadowCrackInput,
        inlinePasswords: shadowCrackInline,
        wordlistPath: shadowCrackWordlist.trim(),
        maxAttempts: 0,
      } as any)) as {
        hash: string;
        ok: boolean;
        password: string;
        attempts: number;
        message: string;
      };
      if (r.ok) {
        setOutput(
          (x) =>
            x +
            `\n[+] 口令验证命中（明文仅表示“与哈希匹配的候选”，非数学解密）\n    明文: ${r.password}\n    尝试次数: ${r.attempts}\n    ${r.message}\n    哈希: ${r.hash}\n`
        );
      } else {
        setOutput(
          (x) =>
            x +
            `\n[-] 未命中: ${r.message}\n    已尝试: ${r.attempts}\n    哈希: ${r.hash}\n`
        );
      }
    } catch (e: unknown) {
      setOutput((x) => x + `\n[-] 处理失败: ${String(e)}\n`);
    } finally {
      setShadowCrackBusy(false);
      setShadowCrackProgress(null);
    }
  }

  async function startForward() {
    if (!connected) return;
    setBusy(true);
    try {
      const r = await StartLocalForward({ listenAddr: fwdListen.trim(), remoteAddr: fwdRemote.trim() } as any);
      setForwardId(String((r as any).id ?? ""));
      setOutput((p) => p + `\n[+] 本地转发已启动: ${String((r as any).listen)} -> ${String((r as any).remote)}\n`);
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 启动转发失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function stopForward() {
    if (!forwardId) return;
    setBusy(true);
    try {
      await StopLocalForward(forwardId);
      setOutput((p) => p + `\n[+] 本地转发已关闭: ${forwardId}\n`);
      setForwardId("");
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 关闭转发失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text) return;
    const next = [...chatMessages, { role: "user" as const, content: text }];
    setChatMessages(next);
    setChatInput("");
    setBusy(true);
    try {
      const res = await AIChat({ messages: next.map((m) => ({ role: m.role, content: m.content })) } as any);
      const assistant = String((res as any).assistant ?? "");
      const toolLog = String((res as any).toolLog ?? "");
      const pending = (res as any).pending ?? null;
      setChatMessages((p) => [...p, { role: "assistant" as const, content: assistant || "（空回复）" }]);
      if (toolLog) setChatToolLog((prev) => (prev ? prev + "\n" + toolLog : toolLog));
      if (pending && pending.name) setChatPending(pending);
    } catch (e: unknown) {
      setChatMessages((p) => [...p, { role: "assistant" as const, content: `[-] AI 调用失败: ${String(e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending(yes: boolean) {
    if (!chatPending) return;
    if (!yes) {
      setChatMessages((p) => [...p, { role: "assistant" as const, content: "已取消高危工具执行。" }]);
      setChatPending(null);
      return;
    }
    setBusy(true);
    try {
      const r = await AIToolExecute({ name: chatPending.name, args: chatPending.args } as any);
      const toolLog = String((r as any).toolLog ?? "");
      if (toolLog) setChatToolLog((prev) => (prev ? prev + "\n" + toolLog : toolLog));
      setChatMessages((p) => [
        ...p,
        { role: "assistant" as const, content: `已执行确认的工具：${chatPending.name}（建议你继续问我总结影响/下一步）` },
      ]);
    } catch (e: unknown) {
      setChatMessages((p) => [...p, { role: "assistant" as const, content: `[-] 工具执行失败: ${String(e)}` }]);
    } finally {
      setChatPending(null);
      setBusy(false);
    }
  }

  async function startShell() {
    if (!connected) return;
    setBusy(true);
    try {
      const term = termRef.current;
      const fit = fitRef.current;
      fit?.fit();
      await SSHStartShell({
        term: "xterm-256color",
        cols: term?.cols ?? 120,
        rows: term?.rows ?? 30,
      } as any);
      setOutput((p) => p + `\n[+] 交互式 shell 已启动（可复制粘贴命令）\n`);
      term?.focus();
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 启动 shell 失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedItem() {
    if (!connected || !selectedItemId) return;
    setBusy(true);
    try {
      const vars: Record<string, string> = {};
      if (webRoot.trim()) vars["Root"] = webRoot.trim();
      const res = await RunPlaybookItem({ itemId: selectedItemId, vars } as any);
      setOutput(
        (p) =>
          p +
          `\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 执行失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function runRemediate() {
    const rid = selectedItem?.remediateId?.trim();
    if (!connected || !rid) return;
    setBusy(true);
    try {
      const vars: Record<string, string> = {};
      if (webRoot.trim()) vars["Root"] = webRoot.trim();
      const res = await RunPlaybookItem({ itemId: rid, vars } as any);
      setOutput(
        (p) =>
          p +
          `\n[+] 关联处置剧本: ${rid}\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 处置剧本执行失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function quickCmd(cmd: string) {
    if (!connected) return;
    setBusy(true);
    try {
      const res = await SSHExec({ command: cmd, timeoutSec: 20, vars: {} } as any);
      setOutput(
        (p) =>
          p +
          `\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 执行失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  function doExtractFlags() {
    setFlagHits(extractFlagsFromText(flagInput, flagLoose));
  }

  function fillFlagFromOutput() {
    setFlagInput(output);
  }

  function splitKeywords(s: string): string[] {
    return s
      .split(/[\n,，;；]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function parsePathsBlock(s: string): string[] {
    return s
      .split(/[\n,，]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function doRemoteFlagSearch() {
    if (!connected) return;
    const nameKeywords = splitKeywords(fsNameKw);
    const contentKeywords = splitKeywords(fsContentKw);
    if (!nameKeywords.length && !contentKeywords.length) {
      alert("请至少填写「文件名关键字」或「文件内容关键字」之一（可自定义多条，用逗号/换行分隔）");
      return;
    }
    setBusy(true);
    try {
      const paths = parsePathsBlock(fsPaths);
      const res = await SSHSearchFlags({
        paths: paths.length ? paths : [],
        nameKeywords,
        contentKeywords,
        maxDepth: fsMaxDepth,
        maxMatches: fsMaxMatch,
        timeoutSec: 240,
      } as any);
      setOutput(
        (p) =>
          p +
          `\n[+] 远端 Flag/关键字搜索\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 远端搜索失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function doRemoteGrepRecursive() {
    if (!connected) return;
    const root = fsGrepRoot.trim();
    const kw = fsGrepKw.trim();
    if (!root) {
      alert("请填写 grep 搜索根目录（绝对路径，如 /var/www）");
      return;
    }
    if (!kw) {
      alert("请填写关键字");
      return;
    }
    setBusy(true);
    try {
      const res = await SSHGrepRecursive({
        root,
        keyword: kw,
        maxLines: fsGrepMaxLines || 500,
        timeoutSec: 300,
        useRegex: fsGrepUseRegex,
      } as any);
      setOutput(
        (p) =>
          p +
          `\n[+] 远端 grep -rni（匹配行）\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] grep 执行失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function doSignalPids() {
    if (!connected) return;
    const pids = minePidInput
      .split(/[\s,，;]+/)
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (!pids.length) {
      alert("请填写 PID（多个用逗号或空格分隔，可从任务输出或 ps 复制）");
      return;
    }
    if (!mineConfirm) {
      alert("请勾选「确认向远端发送信号」后再执行");
      return;
    }
    const sigName = mineSignal === 9 ? "SIGKILL(9)" : "SIGTERM(15)";
    if (!window.confirm(`将向远端发送 ${sigName} 到 PID: ${pids.join(", ")}，确定？`)) return;
    setBusy(true);
    try {
      const res = await SSHSignalPids({
        pids,
        signal: mineSignal,
        timeoutSec: 45,
      } as any);
      setOutput(
        (p) =>
          p +
          `\n[+] PID 信号处置 (${sigName})\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 信号发送失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function doGuardAnalysis() {
    if (!connected) return;
    const p = guardPath.trim();
    if (!p) {
      alert("请填写矿码文件或目录的绝对路径（例如 /tmp/xmrig）");
      return;
    }
    setBusy(true);
    try {
      const res = await SSHGuardAnalysis(p);
      setOutput(
        (prev) =>
          prev +
          `\n[+] 守护/占用分析: ${p}\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 分析失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  async function runPkillRiskPlaybook() {
    if (!connected) return;
    if (!window.confirm("将执行剧本「pkill 常见挖矿进程名」，可能误杀合法进程。仅在你已确认矿码时继续。")) return;
    setBusy(true);
    try {
      const res = await RunPlaybookItem({ itemId: "mining.remediate_pkill_common", vars: {} } as any);
      setOutput(
        (p) =>
          p +
          `\n[+] 高风险 pkill 剧本\n$ ${res.command}\n${res.stdout}${res.stderr}\n[exit=${res.exitCode} ms=${res.durationMs}]\n`
      );
    } catch (e: unknown) {
      setOutput((p) => p + `\n[-] 执行失败: ${String(e)}\n`);
    } finally {
      setBusy(false);
    }
  }

  function scrollToTerminal() {
    termWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="appRoot">
      <CyberBackground />
      <div className="hudVignette" aria-hidden />
      <div className="layout">
        <aside className="sidebar">
          <header className="brand">
            <div className="brandCube" aria-hidden>
              <div className="cube">
                <span className="cubeFace" />
                <span className="cubeFace" />
                <span className="cubeFace" />
                <span className="cubeFace" />
                <span className="cubeFace" />
                <span className="cubeFace" />
              </div>
            </div>
            <div>
              <h1 className="brandTitle">Linux IR Console</h1>
              <p className="brandSub">SSH · 远端 Flag/关键字搜文件 · PID 处置 · 剧本检测</p>
            </div>
          </header>

          <div className="panel glass">
            <div className="panelTitle">连接</div>
            <label className="field">
              <span>Host</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10" />
            </label>
            <label className="field">
              <span>Port</span>
              <input
                value={String(port)}
                onChange={(e) => setPort(Number(e.target.value || "22"))}
                inputMode="numeric"
                placeholder="22"
              />
            </label>
            <label className="field">
              <span>User</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" />
            </label>
            <label className="field">
              <span>Password</span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
            </label>
            <div className="row">
              {!connected ? (
                <button disabled={busy} onClick={doConnect}>
                  连接
                </button>
              ) : (
                <button disabled={busy} onClick={doDisconnect}>
                  断开
                </button>
              )}
              <button disabled={busy || !connected} onClick={startShell}>
                启动交互式 Shell
              </button>
            </div>
          </div>

          <div className="panel glass">
            <div className="panelTitle">MySQL 数据库</div>
            <p className="hint small">
              Navicat 式工作台：可<strong>直连</strong> IP:3306，或<strong>先 SSH</strong> 再连靶机上的{" "}
              <code>127.0.0.1:3306</code>。只需数据库账号与密码（及可选库名）。
            </p>
            <div className="row wrap">
              <button type="button" className="btnAccent" onClick={() => setMysqlWorkbenchOpen(true)}>
                打开 MySQL 工作台
              </button>
            </div>
          </div>

          <div className="panel glass">
            <div className="panelTitle">一键检查 / 单项执行</div>
            <label className="field">
              <span>分类</span>
              <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>检查项</span>
              <select value={selectedItemId} onChange={(e) => setSelectedItemId(e.target.value)}>
                <option value="">（请选择）</option>
                {itemsInCategory.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>WebRoot</span>
              <input value={webRoot} onChange={(e) => setWebRoot(e.target.value)} placeholder="/var/www" />
            </label>
            {selectedItem?.description ? (
              <p className="hint">{selectedItem.description}</p>
            ) : null}
            <div className="row wrap">
              <button disabled={busy || !connected || !selectedItemId} onClick={runSelectedItem}>
                执行选中项
              </button>
              <button
                disabled={busy || !connected || !selectedItem?.remediateId}
                onClick={runRemediate}
                title={selectedItem?.remediateId ?? ""}
                className="btnAccent"
              >
                执行关联处置
              </button>
              <button disabled={busy || !connected} onClick={() => quickCmd("id; whoami; hostname; date")}>
                快速探测
              </button>
            </div>
            <p className="hint small">
              「关联处置」执行只读加固采集剧本。真正结束进程请用下方「矿码处置」。
            </p>
          </div>

          <div className="panel glass">
            <div className="panelTitle">SFTP 文件管理（MVP）</div>
            <label className="field">
              <span>远端路径</span>
              <input value={sftpPath} onChange={(e) => setSftpPath(e.target.value)} placeholder="/var/www" />
            </label>
            <div className="row wrap">
              <button disabled={busy || !connected} onClick={sftpRefresh}>
                刷新
              </button>
              <button disabled={busy || !connected} onClick={sftpUp}>
                上级目录
              </button>
              <button disabled={busy || !connected} onClick={sftpUpload}>
                上传文件
              </button>
            </div>
            <div className="sftpList">
              {sftpEntries.slice(0, 120).map((e) => (
                <div key={e.path} className="sftpRow">
                  <button
                    className="sftpName"
                    disabled={busy}
                    onClick={() => (e.isDir ? setSftpPath(e.path) : sftpDownload(e.path))}
                    title={e.path}
                  >
                    {e.isDir ? "DIR " : "FILE "}
                    {e.name}
                  </button>
                  {!e.isDir ? (
                    <button className="sftpBtn" disabled={busy || !connected} onClick={() => sftpDownload(e.path)}>
                      下载
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="hint small">点击文件下载；点击目录进入。上传会弹出本地文件选择框。</p>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button disabled={busy || !connected} className="btnAccent" onClick={() => {
                setSftpMgrOpen(true);
                // 首次打开自动加载
                if (!localPath) refreshLocal(".");
                refreshRemote(sftpPath);
              }}>
                打开 XFTP 风格管理器（可编辑）
              </button>
            </div>
          </div>

          {sftpMgrOpen ? (
            <div className="modalMask" onMouseDown={(e) => {
              if (e.target === e.currentTarget) setSftpMgrOpen(false);
            }}>
              <div className="modalCard glass">
                <div className="modalHeader">
                  <div>
                    <strong>SFTP 管理器</strong>
                    <span className="outputTitleHint">双栏 · 远端文件可编辑（复制/粘贴）</span>
                  </div>
                  <div className="row">
                    <button type="button" className="btnMini" onClick={() => { refreshLocal(); refreshRemote(); }}>
                      刷新
                    </button>
                    <button type="button" className="btnMini" onClick={() => setSftpMgrOpen(false)}>
                      关闭
                    </button>
                  </div>
                </div>

                <div className="xftpGrid">
                  <div className="xftpPane">
                    <div className="xftpBar">
                      <strong>本地</strong>
                      <input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="C:\\ 或 ." />
                      <button className="btnMini" disabled={busy} onClick={() => refreshLocal(localPath)}>进入</button>
                    </div>
                    <div className="xftpList">
                      <div className="xftpRow xftpRowHead">
                        <span>名称</span><span>类型</span><span style={{ textAlign: "right" }}>大小</span>
                      </div>
                      {localEntries.map((e) => (
                        <button
                          key={e.path}
                          className="xftpRow"
                          type="button"
                          disabled={busy}
                          onDoubleClick={() => (e.isDir ? refreshLocal(e.path) : openLocalEditor(e.path))}
                          onClick={() => navigator.clipboard.writeText(e.path).catch(() => {})}
                          title="单击复制路径；双击进入/编辑"
                        >
                          <span className="mono">{e.name}</span>
                          <span>{e.isDir ? "DIR" : "FILE"}</span>
                          <span style={{ textAlign: "right" }}>{e.isDir ? "" : String(e.size ?? "")}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="xftpPane">
                    <div className="xftpBar">
                      <strong>远端</strong>
                      <input value={remotePath} onChange={(e) => setRemotePath(e.target.value)} placeholder="/root" />
                      <button className="btnMini" disabled={busy} onClick={() => refreshRemote(remotePath)}>进入</button>
                      <button className="btnMini" disabled={busy} onClick={() => SFTPUploadDialog(remotePath).then(() => refreshRemote()).catch((e) => setOutput((x) => x + `\n[-] 上传失败: ${String(e)}\n`))}>
                        上传…
                      </button>
                    </div>
                    <div className="xftpList">
                      <div className="xftpRow xftpRowHead">
                        <span>名称</span><span>类型</span><span style={{ textAlign: "right" }}>大小</span>
                      </div>
                      {remoteEntries.map((e) => (
                        <button
                          key={e.path}
                          className="xftpRow"
                          type="button"
                          disabled={busy}
                          onDoubleClick={() => (e.isDir ? refreshRemote(e.path) : openRemoteEditor(e.path))}
                          onClick={() => navigator.clipboard.writeText(e.path).catch(() => {})}
                          title="单击复制路径；双击进入/编辑"
                        >
                          <span className="mono">{e.name}</span>
                          <span>{e.isDir ? "DIR" : "FILE"}</span>
                          <span style={{ textAlign: "right" }}>{e.isDir ? "" : String(e.size ?? "")}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {editOpen ? (
                  <div className="editorMask" onMouseDown={(e) => {
                    if (e.target === e.currentTarget) setEditOpen(false);
                  }}>
                    <div className="editorCard glass">
                      <div className="modalHeader">
                        <div>
                          <strong>{editKind === "remote" ? "远端编辑" : "本地编辑"}</strong>
                          <span className="outputTitleHint mono">{editPath}</span>
                          {editDirty ? <span className="outputTitleHint">（未保存）</span> : null}
                        </div>
                        <div className="row">
                          <button className="btnMini btnAccent" disabled={busy} onClick={saveEditor}>
                            保存
                          </button>
                          <button className="btnMini" disabled={busy} onClick={() => setEditOpen(false)}>
                            关闭
                          </button>
                        </div>
                      </div>
                      <textarea
                        className="editorArea"
                        value={editText}
                        onChange={(e) => {
                          setEditText(e.target.value);
                          setEditDirty(true);
                        }}
                        spellCheck={false}
                        placeholder="这里可直接复制/粘贴编辑文件内容"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="panel glass">
            <div className="panelTitle">Shadow 口令哈希（词表验证）</div>
            <p className="hint small">
              Linux <code>$6$</code> 等为单向哈希，<strong>无法反推明文</strong>。本功能仅将你提供的候选口令与哈希比对（弱口令核查）。
              可粘贴整行 <code>/etc/shadow</code>，或只粘贴 <code>$6$...</code> 段。
            </p>
            <label className="field flagField">
              <span>shadow 行或哈希</span>
              <textarea
                className="monoArea"
                rows={3}
                value={shadowCrackInput}
                onChange={(e) => setShadowCrackInput(e.target.value)}
                placeholder={`root:$6$yvSXpdkBPXnhkM2d$....::0:99999:7:::`}
                spellCheck={false}
              />
            </label>
            <label className="field flagField">
              <span>内联候选（可选，每行一个）</span>
              <textarea
                className="monoArea"
                rows={3}
                value={shadowCrackInline}
                onChange={(e) => setShadowCrackInline(e.target.value)}
                placeholder={"password123\nadmin\n..."}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>词表文件（可选）</span>
              <div className="row wrap" style={{ alignItems: "center" }}>
                <input
                  readOnly
                  value={shadowCrackWordlist}
                  placeholder="未选择（可只使用内联候选）"
                  style={{ flex: 1, minWidth: 120 }}
                />
                <button type="button" disabled={shadowCrackBusy} onClick={pickShadowWordlist}>
                  选择词表…
                </button>
              </div>
            </label>
            <div className="row wrap">
              <button type="button" className="btnAccent" disabled={shadowCrackBusy} onClick={runShadowCrack}>
                {shadowCrackBusy ? "验证中…" : "开始验证"}
              </button>
              {shadowCrackProgress != null ? (
                <span className="hint small">已尝试约 {shadowCrackProgress} 条（词表）</span>
              ) : null}
            </div>
          </div>

          <div className="panel glass">
            <div className="panelTitle">离线：系统命令篡改校验/修复</div>
            <p className="hint small">
              无需联网：先点「离线校验」用 <code>dpkg -V</code>/<code>rpm -V</code> 发现被改的包；若需修复，把对应{" "}
              <code>.deb/.rpm</code> 离线包上传到远端，再点「离线修复（安装包）」。
            </p>
            <div className="row wrap">
              <button disabled={busy || !connected} onClick={offlineVerify} className="btnAccent">
                离线校验（dpkg -V / rpm -V）
              </button>
            </div>
            <label className="field">
              <span>上传目录</span>
              <input value={offlinePkgDir} onChange={(e) => setOfflinePkgDir(e.target.value)} placeholder="/tmp/ir-packages" />
            </label>
            <div className="row wrap">
              <button disabled={busy || !connected} onClick={offlineUploadPkg}>
                上传离线包（.deb/.rpm）
              </button>
            </div>
            <label className="field">
              <span>包路径</span>
              <input
                value={offlinePkgPath}
                onChange={(e) => setOfflinePkgPath(e.target.value)}
                placeholder="/tmp/ir-packages/coreutils.deb"
              />
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={offlineForceNodeps}
                onChange={(e) => setOfflineForceNodeps(e.target.checked)}
              />
              rpm 跳过依赖（--nodeps，高风险）
            </label>
            <div className="row wrap">
              <button disabled={busy || !connected || !offlinePkgPath.trim()} onClick={offlineInstallPkg} className="btnDangerOutline">
                离线修复（安装包）
              </button>
            </div>
          </div>

          <div className="panel glass">
            <div className="panelTitle">SSH 隧道（本地端口转发）</div>
            <label className="field">
              <span>本地监听</span>
              <input value={fwdListen} onChange={(e) => setFwdListen(e.target.value)} placeholder="127.0.0.1:18080" />
            </label>
            <label className="field">
              <span>远端地址</span>
              <input value={fwdRemote} onChange={(e) => setFwdRemote(e.target.value)} placeholder="10.0.0.2:80" />
            </label>
            <div className="row wrap">
              {!forwardId ? (
                <button disabled={busy || !connected} onClick={startForward}>
                  启动转发
                </button>
              ) : (
                <button disabled={busy} onClick={stopForward}>
                  关闭转发
                </button>
              )}
              {forwardId ? <span className="hint small">ID: {forwardId}</span> : null}
            </div>
          </div>

          <div className="panel glass">
            <div className="panelTitle">AI 设置（Ollama / 在线 API）</div>
            <label className="field">
              <span>Provider</span>
              <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value as any)}>
                <option value="none">不启用</option>
                <option value="ollama">Ollama（本地）</option>
                <option value="openai_compatible">OpenAI 兼容</option>
              </select>
            </label>

            {aiProvider === "ollama" ? (
              <>
                <label className="field">
                  <span>BaseURL</span>
                  <input value={ollamaBaseUrl} onChange={(e) => setOllamaBaseUrl(e.target.value)} />
                </label>
                <label className="field">
                  <span>模型</span>
                  <select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                    <option value="">（请选择/先刷新）</option>
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="row wrap">
                  <button disabled={busy} onClick={refreshOllama}>
                    扫描本机模型
                  </button>
                  <button disabled={busy || !settingsLoaded} onClick={saveSettings}>
                    保存设置
                  </button>
                </div>
              </>
            ) : null}

            {aiProvider === "openai_compatible" ? (
              <>
                <label className="field">
                  <span>BaseURL</span>
                  <input value={openaiBaseUrl} onChange={(e) => setOpenaiBaseUrl(e.target.value)} />
                </label>
                <label className="field">
                  <span>API Key</span>
                  <input value={openaiApiKey} onChange={(e) => setOpenaiApiKey(e.target.value)} type="password" />
                </label>
                <label className="field">
                  <span>模型</span>
                  <input value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} />
                </label>
                <div className="row wrap">
                  <button disabled={busy || !settingsLoaded} onClick={saveSettings}>
                    保存设置
                  </button>
                </div>
              </>
            ) : null}

            {aiProvider === "none" ? (
              <div className="row wrap">
                <button disabled={busy || !settingsLoaded} onClick={saveSettings}>
                  保存设置
                </button>
              </div>
            ) : null}
          </div>

          <div className="panel glass panelDanger">
            <div className="panelTitle">矿码处置（PID / pkill）</div>
            <p className="hint small">
              从检测结果或 <code>ps</code> 中抄下恶意 PID，发送 SIGTERM 先试，必要时 SIGKILL。需 root 权限时请在终端用 sudo。
            </p>
            <label className="field flagField">
              <span>PID 列表</span>
              <input
                value={minePidInput}
                onChange={(e) => setMinePidInput(e.target.value)}
                placeholder="例: 1234 5678 或 1234,5678"
              />
            </label>
            <div className="row wrap">
              <label className="lblRadio">
                <input
                  type="radio"
                  name="sig"
                  checked={mineSignal === 15}
                  onChange={() => setMineSignal(15)}
                />
                SIGTERM 15
              </label>
              <label className="lblRadio">
                <input
                  type="radio"
                  name="sig"
                  checked={mineSignal === 9}
                  onChange={() => setMineSignal(9)}
                />
                SIGKILL 9
              </label>
            </div>
            <label className="chk">
              <input type="checkbox" checked={mineConfirm} onChange={(e) => setMineConfirm(e.target.checked)} />
              确认向远端发送信号
            </label>
            <div className="row wrap">
              <button type="button" disabled={busy || !connected} onClick={doSignalPids} className="btnDanger">
                对 PID 发信号
              </button>
              <button
                type="button"
                disabled={busy || !connected}
                onClick={runPkillRiskPlaybook}
                className="btnDangerOutline"
              >
                高风险：pkill 常见矿工程序名
              </button>
            </div>
            <div className="panelSep" />
            <p className="hint small">
              <strong>删不掉</strong>（<code>Text file busy</code>、<code>Operation not permitted</code>、删了又回来）：先跑下面「守护分析」看{" "}
              <code>lsof</code> / <code>systemd</code> / <code>cron</code> / <code>lsattr +i</code>；输出末尾 <strong>###11</strong> 会列出可复制的{" "}
              <code>kill</code> / <code>rm</code> 顺序。再按需结束 PID 或 <code>chattr -i</code> 后删除。
            </p>
            <label className="field flagField">
              <span>矿码路径（绝对路径）</span>
              <input
                value={guardPath}
                onChange={(e) => setGuardPath(e.target.value)}
                placeholder="/tmp/xmrig 或 /var/tmp/miner.sh"
              />
            </label>
            <div className="row wrap">
              <button type="button" disabled={busy || !connected} onClick={doGuardAnalysis} className="btnAccent">
                守护/占用分析
              </button>
            </div>
          </div>

          <div className="panel glass">
            <div className="panelTitle">Flag 搜索（远端文件）</div>
            <p className="hint small">
              在已连接 SSH 的机器上，用 <strong>自定义关键字</strong> 搜文件名（find -iname）与文件内容（grep
              仅列文件名）。多关键字用逗号或换行分隔。若要像终端一样看<strong>匹配行</strong>，请用下方「grep -rni」。
            </p>
            <label className="field flagField">
              <span>搜索根目录</span>
              <textarea
                className="flagTextarea"
                rows={3}
                value={fsPaths}
                onChange={(e) => setFsPaths(e.target.value)}
                placeholder="/tmp 每行一个或用逗号分隔"
              />
            </label>
            <label className="field flagField">
              <span>文件名含（可选）</span>
              <input
                value={fsNameKw}
                onChange={(e) => setFsNameKw(e.target.value)}
                placeholder="例: xmrig, miner, .sh"
              />
            </label>
            <label className="field flagField">
              <span>文件内容含（可选）</span>
              <input
                value={fsContentKw}
                onChange={(e) => setFsContentKw(e.target.value)}
                placeholder="例: flag{, stratum, xmrig"
              />
            </label>
            <div className="row wrap">
              <label className="field compact">
                <span>最大深度</span>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={fsMaxDepth}
                  onChange={(e) => setFsMaxDepth(Number(e.target.value) || 6)}
                />
              </label>
              <label className="field compact">
                <span>每类最多条数</span>
                <input
                  type="number"
                  min={10}
                  max={400}
                  value={fsMaxMatch}
                  onChange={(e) => setFsMaxMatch(Number(e.target.value) || 120)}
                />
              </label>
            </div>
            <div className="row wrap">
              <button type="button" disabled={busy || !connected} onClick={doRemoteFlagSearch} className="btnAccent">
                远端搜索
              </button>
            </div>

            <hr className="panelSep" />
            <p className="hint small">
              <strong>grep -rni</strong>：递归目录，输出<strong>含关键字的行</strong>（等价{" "}
              <code>grep -rniF</code> 固定字符串；勾选「正则」则为 <code>grep -rniE</code>）。只需指定目录与关键字。
            </p>
            <label className="field">
              <span>grep 目录</span>
              <input
                value={fsGrepRoot}
                onChange={(e) => setFsGrepRoot(e.target.value)}
                placeholder="/var/www"
              />
            </label>
            <label className="field">
              <span>grep 关键字</span>
              <input
                value={fsGrepKw}
                onChange={(e) => setFsGrepKw(e.target.value)}
                placeholder='flag{'
              />
            </label>
            <div className="row wrap">
              <label className="field compact">
                <span>最多行数</span>
                <input
                  type="number"
                  min={10}
                  max={5000}
                  value={fsGrepMaxLines}
                  onChange={(e) => setFsGrepMaxLines(Number(e.target.value) || 500)}
                />
              </label>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={fsGrepUseRegex}
                  onChange={(e) => setFsGrepUseRegex(e.target.checked)}
                />
                正则（-E），否则固定串（-F）
              </label>
            </div>
            <div className="row wrap">
              <button type="button" disabled={busy || !connected} onClick={doRemoteGrepRecursive} className="btnAccent">
                执行 grep -rni
              </button>
            </div>
          </div>

          <div className="panel glass">
            <div className="panelTitle">本地文本：Flag 形态提取</div>
            <p className="hint small">仅解析本机粘贴的文本（不上传 SSH）。与上方「远端文件搜索」不同。</p>
            <label className="field flagField">
              <span>文本</span>
              <textarea
                className="flagTextarea"
                rows={4}
                value={flagInput}
                onChange={(e) => setFlagInput(e.target.value)}
                placeholder="粘贴终端/日志输出…"
              />
            </label>
            <label className="chk">
              <input type="checkbox" checked={flagLoose} onChange={(e) => setFlagLoose(e.target.checked)} />
              宽松匹配 xxx&#123;…&#125;
            </label>
            <div className="row wrap">
              <button type="button" onClick={doExtractFlags}>
                从文本提取
              </button>
              <button type="button" onClick={fillFlagFromOutput}>
                从任务输出填入
              </button>
              <button
                type="button"
                onClick={() => {
                  setFlagInput("");
                  setFlagHits([]);
                }}
              >
                清空
              </button>
            </div>
            {flagHits.length > 0 ? (
              <ul className="flagList">
                {flagHits.map((f) => (
                  <li key={f} className="flagChipRow">
                    <code className="flagChip">{f}</code>
                    <button
                      type="button"
                      className="btnMini"
                      onClick={() => navigator.clipboard.writeText(f)}
                    >
                      复制
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint small muted">（无匹配时检查关键字或开宽松）</p>
            )}
          </div>
        </aside>

        <div
          className="main"
          style={{
            gridTemplateRows: `${termHeight}px 10px minmax(320px, 1fr)`,
          }}
        >
          <div className="termWrap glass" ref={termWrapRef} style={{ height: termHeight }}>
            <div className="termTitle">
              交互式终端（像 Xshell 一样复制/粘贴）
              <span className="outputTitleHint">滚动丢了？点右侧回到终端</span>
              <button type="button" className="btnMini" style={{ float: "right" }} onClick={scrollToTerminal}>
                回到终端
              </button>
            </div>
            <div className="term" ref={termDivRef} />
          </div>
          <div
            className="splitter"
            title="拖拽调整终端高度"
            onPointerDown={onSplitterPointerDown}
            onPointerMove={onSplitterPointerMove}
            onPointerUp={onSplitterPointerUp}
            onPointerCancel={onSplitterPointerUp}
          />
          <div className="outputWrap glass">
            <div className="outputTitle">AI 对话（可调用内置工具）</div>
            <div className="chatWrap">
              <div className="chatHistory">
                {chatMessages.length ? (
                  chatMessages.slice(-40).map((m, i) => (
                    <div key={i} className={m.role === "user" ? "chatMsg chatUser" : "chatMsg chatAssistant"}>
                      <div className="chatRole">{m.role === "user" ? "你" : "AI"}</div>
                      <div className="chatBody">
                        <TaskOutputHighlight text={m.content} />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="hint small muted">（提示：你可以说“分析任务输出里错误原因”“帮我执行矿码检测剧本”等）</p>
                )}
              </div>
              <div className="chatInputRow">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="输入问题/需求（回车发送）"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                />
                <button disabled={busy} onClick={sendChat}>
                  发送
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setChatMessages([]);
                    setChatToolLog("");
                  }}
                >
                  清空
                </button>
              </div>
              {chatToolLog ? (
                <div className="chatToolLog">
                  <div className="outputTitleHint">工具调用日志（异常高亮）</div>
                  <TaskOutputHighlight text={chatToolLog} />
                </div>
              ) : null}
              {chatPending ? (
                <div className="chatToolLog">
                  <div className="outputTitleHint">
                    高危工具确认（risk={chatPending.risk}）
                  </div>
                  <TaskOutputHighlight text={`tool=${chatPending.name}\nreason=${chatPending.reason}\nargs=${JSON.stringify(chatPending.args, null, 2)}`} />
                  <div className="row wrap" style={{ paddingTop: 10 }}>
                    <button className="btnAccent" disabled={busy} onClick={() => confirmPending(true)}>
                      我确认执行
                    </button>
                    <button disabled={busy} onClick={() => confirmPending(false)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="outputWrap glass">
            <div className="outputTitle">
              任务输出
              <span className="outputTitleHint" title="自动高亮矿池/恶意关键字、错误与中文异常、非零 exit、Flag 等">
                · 异常高亮
              </span>
            </div>
            {output ? (
              <TaskOutputHighlight text={output} />
            ) : (
              <pre className="output output-placeholder">
                （这里显示一键检查 / 单项执行 / 关联处置的输出）
              </pre>
            )}
          </div>
        </div>
      </div>
      <MySQLWorkbench
        open={mysqlWorkbenchOpen}
        onClose={() => setMysqlWorkbenchOpen(false)}
        sshConnected={connected}
        onLog={(line) => setOutput((p) => p + line)}
      />
    </div>
  );
}

export default App;
