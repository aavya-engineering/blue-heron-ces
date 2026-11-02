// Minimal YAML-subset parser for the CES handoff kit (no dependencies).
//
// Supported subset (everything the kit's YAML files use):
//   - block mappings (`key: value`, `key:` + indented block) and block sequences (`- item`,
//     `- key: value` starting an inline mapping), a sequence may sit at its parent key's indent
//   - flow mappings `{ a: 1, b: [x, y] }` and flow sequences `[a, b]`, nested, on one or more lines
//   - scalars: double-quoted (escapes \" \\ \n \t \r \/ \uXXXX), single-quoted ('' = '), plain;
//     plain `null`, `~` and empty -> null, `true`/`false` -> boolean, integers/decimals -> number
//   - block scalars `|` and `>` (with optional `-` / `+` chomping indicator)
//   - `#` comments (at line start or after whitespace, outside quotes), a leading `---`
// Not supported (throws or is read as plain text): anchors/aliases, tags, multi-document streams,
// complex keys, tabs for indentation.

export class YamlError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.line = line;
  }
}

function stripComment(text) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inD) {
      if (c === '\\') i++;
      else if (c === '"') inD = false;
    } else if (inS) {
      if (c === "'") {
        if (text[i + 1] === "'") i++;
        else inS = false;
      }
    } else if (c === '"') inD = true;
    else if (c === "'") inS = true;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

function toLines(src) {
  const raw = src.replace(/^﻿/, '').split(/\r?\n/);
  return raw.map((r, i) => {
    if (/^\t/.test(r)) throw new YamlError('tab indentation is not supported', i + 1);
    const noComment = stripComment(r).replace(/\s+$/, '');
    const indent = noComment.length - noComment.trimStart().length;
    return { no: i + 1, raw: r, indent, text: noComment.trimStart() };
  });
}

export function parseScalar(s, lineNo) {
  const t = s.trim();
  if (t === '' || t === '~' || t === 'null' || t === 'Null' || t === 'NULL') return null;
  if (t === 'true' || t === 'True' || t === 'TRUE') return true;
  if (t === 'false' || t === 'False' || t === 'FALSE') return false;
  if (t[0] === '"' || t[0] === "'") {
    const { value, end } = readQuoted(t, 0, lineNo);
    if (t.slice(end).trim() !== '') throw new YamlError(`unexpected text after quoted scalar: ${t.slice(end)}`, lineNo);
    return value;
  }
  if (/^[-+]?\d+$/.test(t)) return Number(t);
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function readQuoted(s, i, lineNo) {
  const q = s[i];
  let out = '';
  let j = i + 1;
  if (q === "'") {
    for (; j < s.length; j++) {
      if (s[j] === "'") {
        if (s[j + 1] === "'") { out += "'"; j++; continue; }
        return { value: out, end: j + 1 };
      }
      out += s[j];
    }
    throw new YamlError('unterminated single-quoted scalar', lineNo);
  }
  const esc = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', '0': '\0', ' ': ' ' };
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') {
      const n = s[j + 1];
      if (n === 'u') {
        const hex = s.slice(j + 2, j + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new YamlError('bad \\u escape', lineNo);
        out += String.fromCharCode(parseInt(hex, 16));
        j += 5;
      } else if (n in esc) {
        out += esc[n];
        j++;
      } else throw new YamlError(`unsupported escape \\${n}`, lineNo);
    } else if (c === '"') return { value: out, end: j + 1 };
    else out += c;
  }
  throw new YamlError('unterminated double-quoted scalar', lineNo);
}

// ---- flow collections ----
function parseFlow(s, lineNo) {
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function value(stops) {
    ws();
    const c = s[i];
    if (c === '{') return map();
    if (c === '[') return seq();
    if (c === '"' || c === "'") {
      const r = readQuoted(s, i, lineNo);
      i = r.end;
      return r.value;
    }
    let j = i;
    while (j < s.length && !stops.includes(s[j])) j++;
    const raw = s.slice(i, j);
    i = j;
    return parseScalar(raw, lineNo);
  }
  function key() {
    ws();
    if (s[i] === '"' || s[i] === "'") {
      const r = readQuoted(s, i, lineNo);
      i = r.end;
      return r.value;
    }
    let j = i;
    while (j < s.length && !(s[j] === ':' && (j + 1 >= s.length || /[\s,}\]]/.test(s[j + 1]))) && s[j] !== ',' && s[j] !== '}') j++;
    const k = s.slice(i, j).trim();
    i = j;
    return k;
  }
  function map() {
    i++; // {
    const out = {};
    ws();
    if (s[i] === '}') { i++; return out; }
    for (;;) {
      const k = key();
      ws();
      if (s[i] !== ':') throw new YamlError(`expected ':' after flow key "${k}"`, lineNo);
      i++;
      if (Object.prototype.hasOwnProperty.call(out, k)) throw new YamlError(`duplicate key "${k}"`, lineNo);
      out[k] = value([',', '}']);
      ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === '}') { i++; return out; } continue; }
      if (s[i] === '}') { i++; return out; }
      throw new YamlError(`expected ',' or '}' in flow mapping`, lineNo);
    }
  }
  function seq() {
    i++; // [
    const out = [];
    ws();
    if (s[i] === ']') { i++; return out; }
    for (;;) {
      out.push(value([',', ']']));
      ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === ']') { i++; return out; } continue; }
      if (s[i] === ']') { i++; return out; }
      throw new YamlError(`expected ',' or ']' in flow sequence`, lineNo);
    }
  }
  const v = value([]);
  ws();
  if (i < s.length) throw new YamlError(`unexpected text after flow collection: ${s.slice(i)}`, lineNo);
  return v;
}

function bracketDepth(s) {
  let d = 0;
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inD) { if (c === '\\') i++; else if (c === '"') inD = false; continue; }
    if (inS) { if (c === "'") { if (s[i + 1] === "'") i++; else inS = false; } continue; }
    if (c === '"') inD = true;
    else if (c === "'") inS = true;
    else if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') d--;
  }
  return d;
}

// Find the `:` that ends a block-mapping key (outside quotes; followed by space or end).
function splitKey(text) {
  let i = 0;
  if (text[0] === '"' || text[0] === "'") {
    const r = readQuoted(text, 0);
    i = r.end;
    const rest = text.slice(i);
    const m = /^\s*:(\s|$)/.exec(rest);
    if (!m) return null;
    return { key: r.value, rest: rest.slice(m[0].length) };
  }
  if (text[0] === '{' || text[0] === '[') return null;
  for (; i < text.length; i++) {
    if (text[i] === ':' && (i + 1 === text.length || text[i + 1] === ' ')) {
      return { key: text.slice(0, i).trim(), rest: text.slice(i + 1) };
    }
  }
  return null;
}

export function parseYaml(src) {
  const lines = toLines(String(src));
  let p = 0;
  const skipBlank = () => { while (p < lines.length && lines[p].text === '') p++; };
  skipBlank();
  if (p < lines.length && lines[p].text === '---') { p++; skipBlank(); }
  if (p >= lines.length) return null;

  const isSeqItem = (l) => l.text === '-' || l.text.startsWith('- ');

  function inlineValue(text, line) {
    const t = text.trim();
    if (t[0] === '{' || t[0] === '[') {
      let buf = t;
      while (bracketDepth(buf) > 0) {
        p++;
        if (p >= lines.length) throw new YamlError('unterminated flow collection', line.no);
        buf += ' ' + lines[p].text;
      }
      return parseFlow(buf, line.no);
    }
    return parseScalar(t, line.no);
  }

  function blockScalar(header, parentIndent, line) {
    const style = header[0];
    const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';
    const body = [];
    let ind = -1;
    while (p + 1 < lines.length) {
      const nx = lines[p + 1];
      const rawIndent = nx.raw.length - nx.raw.trimStart().length;
      if (nx.raw.trim() === '') { body.push(''); p++; continue; }
      if (ind === -1) {
        if (rawIndent <= parentIndent) break;
        ind = rawIndent;
      }
      if (rawIndent < ind) break;
      body.push(nx.raw.slice(ind).replace(/\s+$/, ''));
      p++;
    }
    while (body.length && body[body.length - 1] === '' && chomp !== 'keep') body.pop();
    let s;
    if (style === '|') s = body.join('\n');
    else {
      s = '';
      for (let k = 0; k < body.length; k++) {
        const b = body[k];
        if (k === 0) s = b;
        else if (b === '') s += '\n';
        else s += (s.endsWith('\n') || s === '' ? '' : ' ') + b;
      }
    }
    if (chomp !== 'strip' && body.length) s += '\n';
    void line;
    return s;
  }

  function valueAfterKey(rest, indent, line) {
    const r = rest.trim();
    if (r === '') {
      p++;
      skipBlank();
      if (p >= lines.length) return null;
      const nx = lines[p];
      if (nx.indent > indent) return block(nx.indent);
      if (nx.indent === indent && isSeqItem(nx)) return seqBlock(indent);
      return null;
    }
    if (/^[|>][-+]?$/.test(r)) {
      const v = blockScalar(r, indent, line);
      p++;
      return v;
    }
    const v = inlineValue(r, line);
    p++;
    return v;
  }

  function mapBlock(indent) {
    const out = {};
    for (;;) {
      skipBlank();
      if (p >= lines.length) return out;
      const l = lines[p];
      if (l.indent < indent) return out;
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.no);
      if (isSeqItem(l)) return out;
      const kv = splitKey(l.text);
      if (!kv) throw new YamlError(`expected "key: value", got: ${l.text}`, l.no);
      if (Object.prototype.hasOwnProperty.call(out, kv.key)) throw new YamlError(`duplicate key "${kv.key}"`, l.no);
      out[kv.key] = valueAfterKey(kv.rest, indent, l);
    }
  }

  function seqBlock(indent) {
    const out = [];
    for (;;) {
      skipBlank();
      if (p >= lines.length) return out;
      const l = lines[p];
      if (l.indent < indent || !isSeqItem(l)) {
        if (l.indent > indent) throw new YamlError('unexpected indentation', l.no);
        return out;
      }
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.no);
      const item = l.text === '-' ? '' : l.text.slice(2);
      const lead = item.length - item.trimStart().length;
      const itemText = item.trimStart();
      if (itemText === '') {
        p++;
        skipBlank();
        if (p < lines.length && lines[p].indent > indent) out.push(block(lines[p].indent));
        else out.push(null);
        continue;
      }
      const kv = itemText[0] === '{' || itemText[0] === '[' ? null : splitKey(itemText);
      if (kv || itemText.startsWith('- ')) {
        // Re-read this line as the first line of a nested block at the item's column.
        lines[p] = { ...l, indent: indent + 2 + lead, text: itemText };
        out.push(block(indent + 2 + lead));
      } else {
        out.push(inlineValue(itemText, l));
        p++;
      }
    }
  }

  function block(indent) {
    skipBlank();
    const l = lines[p];
    if (isSeqItem(l)) return seqBlock(indent);
    if (!splitKey(l.text)) {
      const v = inlineValue(l.text, l);
      p++;
      return v;
    }
    return mapBlock(indent);
  }

  const doc = block(lines[p].indent);
  skipBlank();
  if (p < lines.length) throw new YamlError(`unexpected content: ${lines[p].text}`, lines[p].no);
  return doc;
}
