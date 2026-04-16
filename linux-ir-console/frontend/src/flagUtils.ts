/** 从文本中提取常见 CTF / 日志中的 flag 形态（去重） */
export function extractFlagsFromText(text: string, loose: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t.length < 5 || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  const strict: RegExp[] = [
    /\bflag\{[^}\r\n]{1,512}\}/gi,
    /\bFLAG\{[^}\r\n]{1,512}\}/gi,
    /\bctf\{[^}\r\n]{1,512}\}/gi,
    /\bCTF\{[^}\r\n]{1,512}\}/gi,
    /\bpicoCTF\{[^}\r\n]{1,512}\}/gi,
    /\bPicoCTF\{[^}\r\n]{1,512}\}/gi,
    /DASCTF\{[^}\r\n]{1,512}\}/gi,
    /NSSCTF\{[^}\r\n]{1,512}\}/gi,
    /hxb\{[^}\r\n]{1,512}\}/gi,
  ];
  for (const re of strict) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) push(m[0]);
  }
  if (loose) {
    const wide = /[A-Za-z][A-Za-z0-9_+-]{1,22}\{[^}\r\n]{3,512}\}/g;
    let m: RegExpExecArray | null;
    while ((m = wide.exec(text)) !== null) push(m[0]);
  }
  return out;
}
