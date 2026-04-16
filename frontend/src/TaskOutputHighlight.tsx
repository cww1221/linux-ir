import { useMemo, type ReactNode } from "react";

/**
 * 高亮策略（参考 AutoIR）：
 * - 以“关键字列表”做字面匹配，输出更稳定（不容易漏/乱高亮）
 * - 同位置命中时：优先更长的匹配；长度相同再比 severity
 * - 仅保留少量正则用于结构化模式（flag/exit/矿池 URL/错误词）
 */
type RegexRule = { kind: "re"; re: RegExp; className: string; sev: number };
type LiteralRule = { kind: "lit"; token: string; className: string; sev: number; wordBoundary: boolean };
type Rule = RegexRule | LiteralRule;

// 来自 AutoIR data/config.json 的关键词（并做了一点收敛，避免噪声过大）
const AUTOIR_KEYWORDS: string[] = [
  "flag{",
  "flag",
  "666c6167",
  "f1ag",
  "fl4g",
  "Zmxh",
  "&#102",
  "MZWGC",
  "102 108 97 103",
  "1100110",
  "ctf",
  "504b0304",
  "key",
  "464C4147",
  "pass",
  "select",
  "/bin/bash",
  "/bin/sh",
];

function isWordToken(s: string) {
  return /^[A-Za-z0-9_]+$/.test(s);
}
function isWordChar(c: string) {
  return /^[A-Za-z0-9_]$/.test(c);
}

const LITERAL_RULES: LiteralRule[] = Array.from(new Set(AUTOIR_KEYWORDS.map((s) => s.trim()).filter(Boolean)))
  .sort((a, b) => b.length - a.length) // 同位置时更长优先
  .map((token) => ({
    kind: "lit" as const,
    token,
    className: "hl-warn",
    sev: 27,
    // 像 "flag"/"pass"/"select" 这类短词，要求词边界，减少把正常单词误高亮
    wordBoundary: isWordToken(token) && token.length <= 12,
  }));

const REGEX_RULES: RegexRule[] = [
  {
    kind: "re",
    re: /\b(?:xmrig|xmr|stratum|minerd|cpuminer|cryptonight|monero|coinhive|kdevtmpfsi|kinsing|watchdog|skid|kthreadd)\b/gi,
    className: "hl-threat",
    sev: 50,
  },
  {
    kind: "re",
    re: /\b(?:stratum\+tcp|stratum\+ssl|stratum:\/\/)[^\s]{6,200}/gi,
    className: "hl-threat",
    sev: 52,
  },
  {
    kind: "re",
    re: /(?:^|\s)(?:3333|4444|5555|7777|14444|9999)(?::|\s|$)/g,
    className: "hl-threat",
    sev: 48,
  },
  // 错误词与非零退出
  {
    kind: "re",
    re: /\[exit=[1-9]\d*[^\]\r\n]*\]/gi,
    className: "hl-error",
    sev: 45,
  },
  {
    kind: "re",
    re: /\b(?:error|failed|failure|fatal|denied|exception|panic|Segmentation fault|corrupted)\b/gi,
    className: "hl-error",
    sev: 40,
  },
  {
    kind: "re",
    re: /Permission denied|No such file|command not found|Operation not permitted|Connection refused|Cannot allocate memory/gi,
    className: "hl-error",
    sev: 41,
  },
  {
    kind: "re",
    re: /失败|错误|异常|拒绝|告警|无效|未找到命令|无法/g,
    className: "hl-error",
    sev: 39,
  },
  // Flag 形态
  {
    kind: "re",
    re: /\b(?:flag|FLAG|ctf|CTF|picoCTF)\{[^}\r\n]{1,256}\}/gi,
    className: "hl-flag",
    sev: 35,
  },
  // 告警文案
  {
    kind: "re",
    re: /\bWARNING\b|可疑|suspicious|malicious|trojan|backdoor|rootkit/gi,
    className: "hl-warn",
    sev: 28,
  },
  // [+] / [-]
  { kind: "re", re: /\[-\]/g, className: "hl-warn", sev: 25 },
  { kind: "re", re: /\[\+\]/g, className: "hl-ok", sev: 15 },
];

const ALL_RULES: Rule[] = [...REGEX_RULES, ...LITERAL_RULES];

type Match = { start: number; end: number; className: string; sev: number; len: number };

function matchLiteral(text: string, lower: string, from: number, rule: LiteralRule): Match | null {
  const token = rule.token;
  const t = token.toLowerCase();
  const idx = lower.indexOf(t, from);
  if (idx < 0) return null;
  const end = idx + token.length;
  if (rule.wordBoundary) {
    const before = idx - 1 >= 0 ? text[idx - 1] : "";
    const after = end < text.length ? text[end] : "";
    if ((before && isWordChar(before)) || (after && isWordChar(after))) {
      // 不是边界：继续向后找下一个
      const next = lower.indexOf(t, idx + 1);
      if (next < 0) return null;
      // 递归一次即可（避免极端长文本深递归）
      const end2 = next + token.length;
      const before2 = next - 1 >= 0 ? text[next - 1] : "";
      const after2 = end2 < text.length ? text[end2] : "";
      if ((before2 && isWordChar(before2)) || (after2 && isWordChar(after2))) return null;
      return { start: next, end: end2, className: rule.className, sev: rule.sev, len: token.length };
    }
  }
  return { start: idx, end, className: rule.className, sev: rule.sev, len: token.length };
}

function matchRegex(text: string, from: number, rule: RegexRule): Match | null {
  const sub = text.slice(from);
  const flags = rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`;
  const r = new RegExp(rule.re.source, flags);
  const m = r.exec(sub);
  if (!m || m[0].length === 0) return null;
  const absStart = from + m.index;
  const absEnd = absStart + m[0].length;
  return { start: absStart, end: absEnd, className: rule.className, sev: rule.sev, len: m[0].length };
}

function findNextMatch(text: string, lower: string, from: number): Match | null {
  let best: Match | null = null;
  for (const rule of ALL_RULES) {
    const m = rule.kind === "lit" ? matchLiteral(text, lower, from, rule) : matchRegex(text, from, rule);
    if (!m) continue;
    if (
      !best ||
      m.start < best.start ||
      (m.start === best.start && (m.len > best.len || (m.len === best.len && m.sev > best.sev)))
    ) {
      best = m;
    }
  }
  return best;
}

function buildHighlighted(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const lower = text.toLowerCase();
  while (i < text.length) {
    const m = findNextMatch(text, lower, i);
    if (!m) {
      nodes.push(text.slice(i));
      break;
    }
    if (m.start > i) {
      nodes.push(text.slice(i, m.start));
    }
    nodes.push(
      <span key={`hl-${k++}`} className={m.className}>
        {text.slice(m.start, m.end)}
      </span>
    );
    i = m.end;
  }
  return nodes;
}

type Props = { text: string };

/** 任务输出：高亮威胁词、错误、非零 exit、Flag 等 */
export function TaskOutputHighlight({ text }: Props) {
  const body = useMemo(() => buildHighlighted(text), [text]);
  return <pre className="output output-highlight">{body}</pre>;
}
