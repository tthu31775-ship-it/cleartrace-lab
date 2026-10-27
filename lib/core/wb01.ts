// WB01 水军评论检测 · 纯 TS 推理实现
// 与算法包 wb01/app.py 数值等价:字符 1/2/3-gram 哈希 TF-IDF(D=8192)+ 线性 sigmoid。
// 权重由 scripts/prepare-wb01-model.py 从 wb01_textonly_model.npz 导出,不依赖 numpy。

import {
  WB01_BIAS,
  WB01_DIM,
  WB01_IDF_B64,
  WB01_INFO,
  WB01_VERSION,
  WB01_W_B64,
} from './wb01-weights';

export const WB01_THRESHOLD = 0.5;
export const WB01_MAX_LENGTH = 1000;
export const WB01_MAX_BATCH = 200;

export type Wb01Label = 'water' | 'normal';
export type Wb01Risk = 'high' | 'medium' | 'low';
export type Wb01Confidence = 'high' | 'medium' | 'low';

export interface Wb01Evidence {
  length: number;
  punctuation: number;
  at_count: number;
  hashtag_count: number;
  emoji_count: number;
}

export interface Wb01Prediction {
  comment_id: string;
  probability: number;
  label: Wb01Label;
  risk_level: Wb01Risk;
  threshold: number;
  confidence: Wb01Confidence;
  model_version: string;
  evidence: Wb01Evidence;
}

const PUNCT_RE = /[，。！？!?、,.…~；;：:]/g;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu;

function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  const view = globalThis.atob(clean);
  const bytes = new Uint8Array(view.length);
  for (let i = 0; i < view.length; i += 1) bytes[i] = view.charCodeAt(i);
  return bytes;
}

function toFloat32(bytes: Uint8Array): Float32Array {
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const out = new Float32Array(aligned.buffer.slice(aligned.byteOffset, aligned.byteOffset + aligned.byteLength));
  // 权重按小端写入;若运行环境是大端,逐元素翻转字节序。
  if (!IS_LITTLE_ENDIAN) {
    const dv = new DataView(out.buffer);
    for (let i = 0; i < out.length; i += 1) out[i] = dv.getFloat32(i * 4, true);
  }
  return out;
}

const IS_LITTLE_ENDIAN = (() => {
  const probe = new Uint16Array([0x0102]);
  return new Uint8Array(probe.buffer)[0] === 0x02;
})();

interface Wb01Model {
  w: Float32Array;
  idf: Float32Array;
  dim: number;
  version: string;
  bias: number;
}

let model: Wb01Model | null = null;

/** 惰性加载权重,首次调用约 1ms 级别,之后复用。 */
export function loadWb01Model(): Wb01Model {
  if (model) return model;
  const w = toFloat32(decodeBase64(WB01_W_B64));
  const idf = toFloat32(decodeBase64(WB01_IDF_B64));
  if (w.length !== WB01_DIM || idf.length !== WB01_DIM) {
    throw new Error(`WB01 权重维度异常: w=${w.length} idf=${idf.length} 期望 ${WB01_DIM}`);
  }
  model = { w, idf, dim: WB01_DIM, version: WB01_VERSION, bias: WB01_BIAS };
  return model;
}

/** 与 app.py clean_text 一致:去 URL、去 @提及、# 替换为空格。 */
export function cleanText(input: string): string {
  let t = typeof input === 'string' ? input : '';
  t = t.replace(/https?:\/\/\S+/g, ' ');
  t = t.replace(/@\S+/g, ' ');
  t = t.replace(/#/g, ' ');
  return t;
}

/** 字符 1/2/3-gram。按码位切分,保证中文与 emoji 与 Python 行为一致。 */
export function grams(input: string): string[] {
  const chars = Array.from(cleanText(input));
  const out: string[] = [];
  for (const n of [1, 2, 3]) {
    if (chars.length >= n) {
      for (let i = 0; i <= chars.length - n; i += 1) out.push(chars.slice(i, i + n).join(''));
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const utf8 = new TextEncoder();

/** 等价于 Python zlib.crc32(bytes) —— 标准 IEEE CRC-32,无符号 32 位。 */
export function crc32(text: string): number {
  const bytes = utf8.encode(text);
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 稀疏版 featurize + 点积。
 * 与 numpy 版 vec[hash]+=1 → log1p → *idf → x@W 完全等价,只是跳过零元素。
 */
export function scoreText(input: string): number {
  const { w, idf, dim, bias } = loadWb01Model();
  const counts = new Map<number, number>();
  for (const g of grams(input)) {
    const idx = crc32(g) % dim;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  let z = bias;
  for (const [idx, count] of counts) {
    z += Math.log1p(count) * idf[idx] * w[idx];
  }
  return z;
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function makeCommentId(): string {
  const bytes = new Uint8Array(5);
  globalThis.crypto.getRandomValues(bytes);
  return 'c_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 单条预测,返回结构与 app.py predict_one + comment_id 一致。 */
export function predictComment(content: string, commentId?: string): Wb01Prediction {
  const text = typeof content === 'string' ? content : '';
  const probability = round(sigmoid(scoreText(text)), 4);
  const label: Wb01Label = probability >= WB01_THRESHOLD ? 'water' : 'normal';
  const risk_level: Wb01Risk = probability >= 0.8 ? 'high' : probability >= 0.5 ? 'medium' : 'low';
  const length = Array.from(text).length;
  const confidence: Wb01Confidence = length < 8 ? 'low' : length < 20 ? 'medium' : 'high';
  return {
    comment_id: commentId && commentId.trim() ? commentId : makeCommentId(),
    probability,
    label,
    risk_level,
    threshold: WB01_THRESHOLD,
    confidence,
    model_version: WB01_VERSION,
    evidence: {
      length,
      punctuation: (text.match(PUNCT_RE) ?? []).length,
      at_count: text.split('@').length - 1,
      hashtag_count: text.split('#').length - 1,
      emoji_count: (text.match(EMOJI_RE) ?? []).length,
    },
  };
}

export interface Wb01BatchItem {
  comment_id?: string;
  content?: unknown;
}

export interface Wb01BatchError {
  comment_id?: string;
  error: string;
}

/** 批量预测(≤200 条),空内容逐条报错但不影响其他条目。 */
export function predictCommentBatch(items: Wb01BatchItem[]): Array<Wb01Prediction | Wb01BatchError> {
  const out: Array<Wb01Prediction | Wb01BatchError> = [];
  for (const raw of items) {
    const item = raw ?? {};
    const content = item.content;
    if (typeof content !== 'string' || !content.trim()) {
      out.push({ comment_id: item.comment_id, error: 'content 为空' });
      continue;
    }
    out.push(predictComment(content, item.comment_id));
  }
  return out;
}

export function wb01ModelInfo() {
  return {
    ...(WB01_INFO as Record<string, unknown>),
    model_version: WB01_VERSION,
    threshold: WB01_THRESHOLD,
    dimension: WB01_DIM,
    features: 'char 1-3 gram hashing TF-IDF, D=8192',
    max_length: WB01_MAX_LENGTH,
    max_batch: WB01_MAX_BATCH,
  };
}

export { WB01_INFO, WB01_VERSION };
