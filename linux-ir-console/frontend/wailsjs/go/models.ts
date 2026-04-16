export namespace config {
	
	export class Settings {
	    aiProvider: string;
	    ollamaBaseUrl: string;
	    ollamaModel: string;
	    openaiBaseUrl: string;
	    openaiApiKey: string;
	    openaiModel: string;
	    maxParallelExec: number;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.aiProvider = source["aiProvider"];
	        this.ollamaBaseUrl = source["ollamaBaseUrl"];
	        this.ollamaModel = source["ollamaModel"];
	        this.openaiBaseUrl = source["openaiBaseUrl"];
	        this.openaiApiKey = source["openaiApiKey"];
	        this.openaiModel = source["openaiModel"];
	        this.maxParallelExec = source["maxParallelExec"];
	    }
	}

}

export namespace main {
	
	export class ChatMessage {
	    role: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	    }
	}
	export class ChatRequest {
	    messages: ChatMessage[];
	
	    static createFrom(source: any = {}) {
	        return new ChatRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.messages = this.convertValues(source["messages"], ChatMessage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PendingToolCall {
	    name: string;
	    args: {[key: string]: any};
	    risk: string;
	    reason: string;
	
	    static createFrom(source: any = {}) {
	        return new PendingToolCall(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.args = source["args"];
	        this.risk = source["risk"];
	        this.reason = source["reason"];
	    }
	}
	export class ChatResponse {
	    assistant: string;
	    toolLog: string;
	    pending?: PendingToolCall;
	
	    static createFrom(source: any = {}) {
	        return new ChatResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.assistant = source["assistant"];
	        this.toolLog = source["toolLog"];
	        this.pending = this.convertValues(source["pending"], PendingToolCall);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CrackShadowRequest {
	    input: string;
	    inlinePasswords: string;
	    wordlistPath: string;
	    maxAttempts: number;
	
	    static createFrom(source: any = {}) {
	        return new CrackShadowRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.input = source["input"];
	        this.inlinePasswords = source["inlinePasswords"];
	        this.wordlistPath = source["wordlistPath"];
	        this.maxAttempts = source["maxAttempts"];
	    }
	}
	export class CrackShadowResponse {
	    hash: string;
	    ok: boolean;
	    password: string;
	    attempts: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new CrackShadowResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hash = source["hash"];
	        this.ok = source["ok"];
	        this.password = source["password"];
	        this.attempts = source["attempts"];
	        this.message = source["message"];
	    }
	}
	export class ExecRequest {
	    command: string;
	    timeoutSec: number;
	    vars: {[key: string]: string};
	
	    static createFrom(source: any = {}) {
	        return new ExecRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.timeoutSec = source["timeoutSec"];
	        this.vars = source["vars"];
	    }
	}
	export class FlagSearchRequest {
	    paths: string[];
	    nameKeywords: string[];
	    contentKeywords: string[];
	    maxDepth: number;
	    maxMatches: number;
	    timeoutSec: number;
	
	    static createFrom(source: any = {}) {
	        return new FlagSearchRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.paths = source["paths"];
	        this.nameKeywords = source["nameKeywords"];
	        this.contentKeywords = source["contentKeywords"];
	        this.maxDepth = source["maxDepth"];
	        this.maxMatches = source["maxMatches"];
	        this.timeoutSec = source["timeoutSec"];
	    }
	}
	export class GrepRecursiveRequest {
	    root: string;
	    keyword: string;
	    maxLines: number;
	    timeoutSec: number;
	    useRegex: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GrepRecursiveRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.root = source["root"];
	        this.keyword = source["keyword"];
	        this.maxLines = source["maxLines"];
	        this.timeoutSec = source["timeoutSec"];
	        this.useRegex = source["useRegex"];
	    }
	}
	export class LocalEntry {
	    name: string;
	    path: string;
	    size: number;
	    mode: string;
	    mtime: number;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LocalEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.mtime = source["mtime"];
	        this.isDir = source["isDir"];
	    }
	}
	export class MySQLConnectRequest {
	    mode: string;
	    host: string;
	    port: number;
	    sshRemoteMysqlAddr: string;
	    user: string;
	    password: string;
	    database: string;
	
	    static createFrom(source: any = {}) {
	        return new MySQLConnectRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.sshRemoteMysqlAddr = source["sshRemoteMysqlAddr"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	    }
	}
	export class MySQLKeywordSearchRequest {
	    schema: string;
	    keyword: string;
	    maxTables: number;
	    maxRowsPerTable: number;
	
	    static createFrom(source: any = {}) {
	        return new MySQLKeywordSearchRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.keyword = source["keyword"];
	        this.maxTables = source["maxTables"];
	        this.maxRowsPerTable = source["maxRowsPerTable"];
	    }
	}
	export class MySQLRunRequest {
	    sql: string;
	    maxRows: number;
	
	    static createFrom(source: any = {}) {
	        return new MySQLRunRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sql = source["sql"];
	        this.maxRows = source["maxRows"];
	    }
	}
	
	export class RunItemRequest {
	    itemId: string;
	    vars: {[key: string]: string};
	
	    static createFrom(source: any = {}) {
	        return new RunItemRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.itemId = source["itemId"];
	        this.vars = source["vars"];
	    }
	}
	export class SignalPidsRequest {
	    pids: number[];
	    signal: number;
	    timeoutSec: number;
	
	    static createFrom(source: any = {}) {
	        return new SignalPidsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pids = source["pids"];
	        this.signal = source["signal"];
	        this.timeoutSec = source["timeoutSec"];
	    }
	}
	export class StartForwardRequest {
	    listenAddr: string;
	    remoteAddr: string;
	
	    static createFrom(source: any = {}) {
	        return new StartForwardRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.listenAddr = source["listenAddr"];
	        this.remoteAddr = source["remoteAddr"];
	    }
	}
	export class StartShellRequest {
	    term: string;
	    cols: number;
	    rows: number;
	
	    static createFrom(source: any = {}) {
	        return new StartShellRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.term = source["term"];
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	    }
	}
	export class ToolExecuteRequest {
	    name: string;
	    args: {[key: string]: any};
	
	    static createFrom(source: any = {}) {
	        return new ToolExecuteRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.args = source["args"];
	    }
	}
	export class ToolExecuteResponse {
	    toolLog: string;
	
	    static createFrom(source: any = {}) {
	        return new ToolExecuteResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.toolLog = source["toolLog"];
	    }
	}

}

export namespace mysqlmgr {
	
	export class KeywordHit {
	    database: string;
	    table: string;
	    sql?: string;
	    columns?: string[];
	    rows?: string[][];
	    truncated?: boolean;
	    rowCount: number;
	    skipReason?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new KeywordHit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.database = source["database"];
	        this.table = source["table"];
	        this.sql = source["sql"];
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	        this.truncated = source["truncated"];
	        this.rowCount = source["rowCount"];
	        this.skipReason = source["skipReason"];
	        this.error = source["error"];
	    }
	}
	export class KeywordSearchResponse {
	    hits: KeywordHit[];
	    tablesScanned: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new KeywordSearchResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hits = this.convertValues(source["hits"], KeywordHit);
	        this.tablesScanned = source["tablesScanned"];
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Result {
	    kind: string;
	    columns?: string[];
	    rows?: string[][];
	    truncated?: boolean;
	    rowsAffected?: number;
	    lastInsertId?: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	        this.truncated = source["truncated"];
	        this.rowsAffected = source["rowsAffected"];
	        this.lastInsertId = source["lastInsertId"];
	        this.error = source["error"];
	    }
	}

}

export namespace playbook {
	
	export class Item {
	    id: string;
	    name: string;
	    category: string;
	    command: string;
	    timeoutSec: number;
	    needsRoot: boolean;
	    description: string;
	    tags: string[];
	    vars: {[key: string]: string};
	    remediateId: string;
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.category = source["category"];
	        this.command = source["command"];
	        this.timeoutSec = source["timeoutSec"];
	        this.needsRoot = source["needsRoot"];
	        this.description = source["description"];
	        this.tags = source["tags"];
	        this.vars = source["vars"];
	        this.remediateId = source["remediateId"];
	    }
	}
	export class Document {
	    version: string;
	    title: string;
	    items: Item[];
	
	    static createFrom(source: any = {}) {
	        return new Document(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.title = source["title"];
	        this.items = this.convertValues(source["items"], Item);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Catalog {
	    docs: Document[];
	
	    static createFrom(source: any = {}) {
	        return new Catalog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.docs = this.convertValues(source["docs"], Document);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace sshx {
	
	export class Auth {
	    password: string;
	    privateKey: string;
	    passphrase: string;
	
	    static createFrom(source: any = {}) {
	        return new Auth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.password = source["password"];
	        this.privateKey = source["privateKey"];
	        this.passphrase = source["passphrase"];
	    }
	}
	export class HostKeyPolicy {
	    mode: string;
	    fingerprint: string;
	
	    static createFrom(source: any = {}) {
	        return new HostKeyPolicy(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.fingerprint = source["fingerprint"];
	    }
	}
	export class JumpHost {
	    host: string;
	    port: number;
	    username: string;
	    auth: Auth;
	    dialTimeout: number;
	
	    static createFrom(source: any = {}) {
	        return new JumpHost(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.auth = this.convertValues(source["auth"], Auth);
	        this.dialTimeout = source["dialTimeout"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProxyConfig {
	    type: string;
	    address: string;
	    username: string;
	    password: string;
	
	    static createFrom(source: any = {}) {
	        return new ProxyConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.address = source["address"];
	        this.username = source["username"];
	        this.password = source["password"];
	    }
	}
	export class ConnectConfig {
	    host: string;
	    port: number;
	    username: string;
	    auth: Auth;
	    dialTimeout: number;
	    proxy: ProxyConfig;
	    jump?: JumpHost;
	    hostKey: HostKeyPolicy;
	
	    static createFrom(source: any = {}) {
	        return new ConnectConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.auth = this.convertValues(source["auth"], Auth);
	        this.dialTimeout = source["dialTimeout"];
	        this.proxy = this.convertValues(source["proxy"], ProxyConfig);
	        this.jump = this.convertValues(source["jump"], JumpHost);
	        this.hostKey = this.convertValues(source["hostKey"], HostKeyPolicy);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ExecResult {
	    command: string;
	    stdout: string;
	    stderr: string;
	    exitCode: number;
	    durationMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ExecResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.command = source["command"];
	        this.stdout = source["stdout"];
	        this.stderr = source["stderr"];
	        this.exitCode = source["exitCode"];
	        this.durationMs = source["durationMs"];
	    }
	}
	export class ForwardRule {
	    id: string;
	    listen: string;
	    remote: string;
	    startedAt: number;
	
	    static createFrom(source: any = {}) {
	        return new ForwardRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.listen = source["listen"];
	        this.remote = source["remote"];
	        this.startedAt = source["startedAt"];
	    }
	}
	
	
	
	export class SFTPEntry {
	    name: string;
	    path: string;
	    size: number;
	    mode: string;
	    mtime: number;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SFTPEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.mtime = source["mtime"];
	        this.isDir = source["isDir"];
	    }
	}

}

