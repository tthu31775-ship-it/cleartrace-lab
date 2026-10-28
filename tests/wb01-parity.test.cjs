// WB01 纯 TS 推理与算法包 app.py 的数值对账。
// 夹具由 scripts/make-wb01-fixtures.py 直接用原始 predict_one 生成。
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const wb01 = require(resolve(__dirname, '..', '.sites-runtime/core-tests/wb01.js'));

const fixturePath = resolve(__dirname, 'fixtures/wb01-samples.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (error) {
    fail += 1;
    failures.push(`${name}: ${error.message}`);
  }
}

const model = wb01.loadWb01Model();

check('模型维度一致', () => {
  assert.equal(model.dim, fixture.dimension);
  assert.equal(model.version, fixture.model_version);
  assert.equal(model.w.length, fixture.dimension);
  assert.equal(model.idf.length, fixture.dimension);
});

// CRC32 与 Python zlib.crc32 对齐(已知向量)。
check('crc32 向量', () => {
  assert.equal(wb01.crc32(''), 0);
  assert.equal(wb01.crc32('a'), 3904355907);
  assert.equal(wb01.crc32('abc'), 891568578);
  assert.equal(wb01.crc32('中文'), 1510599991);
  assert.equal(wb01.crc32('这事必须严查'), 3304559370);
});

check('clean_text 与 Python 一致', () => {
  assert.equal(wb01.cleanText('看 https://a.cn/x?y=1 吧'), '看   吧');
  assert.equal(wb01.cleanText('@小明 你好#话题#'), '  你好 话题 ');
  assert.equal(wb01.cleanText(null), '');
  assert.equal(wb01.cleanText(undefined), '');
});

check('grams 覆盖 1/2/3-gram', () => {
  assert.deepEqual(wb01.grams('ab'), ['a', 'b', 'ab']);
  assert.deepEqual(wb01.grams(''), []);
  assert.equal(wb01.grams('中文评论').length, 9); // 4 + 3 + 2
});

// 主对账:逐条比对 probability / label / risk / confidence / evidence。
let worst = 0;
for (const sample of fixture.samples) {
  check(`样例 ${sample.case}`, () => {
    const actual = wb01.predictComment(sample.content, sample.comment_id);
    const expected = sample.expected;
    worst = Math.max(worst, Math.abs(actual.probability - expected.probability));
    assert.ok(
      Math.abs(actual.probability - expected.probability) <= 5e-4,
      `概率偏差 ${actual.probability} vs ${expected.probability}`,
    );
    assert.equal(actual.probability, expected.probability, '概率应逐位一致');
    assert.equal(actual.label, expected.label);
    assert.equal(actual.risk_level, expected.risk_level);
    assert.equal(actual.confidence, expected.confidence);
    assert.equal(actual.threshold, expected.threshold);
    assert.equal(actual.model_version, expected.model_version);
    assert.deepEqual(actual.evidence, expected.evidence);
    if (sample.comment_id) assert.equal(actual.comment_id, sample.comment_id);
  });
}

check('批量预测 200 条上限语义', () => {
  const items = fixture.samples.slice(0, 5).map((s) => ({ content: s.content, comment_id: s.comment_id }));
  items.push({ content: '   ', comment_id: 'blank-1' });
  const out = wb01.predictCommentBatch(items);
  assert.equal(out.length, 6);
  assert.equal(out[0].probability, fixture.samples[0].expected.probability);
  assert.equal(out[5].error, 'content 为空');
  assert.equal(out[5].comment_id, 'blank-1');
});

check('自动生成 comment_id', () => {
  const a = wb01.predictComment('测试');
  const b = wb01.predictComment('测试');
  assert.match(a.comment_id, /^c_[0-9a-f]{10}$/);
  assert.notEqual(a.comment_id, b.comment_id);
});

check('模型信息', () => {
  const info = wb01.wb01ModelInfo();
  assert.equal(info.model_version, 'wb01-textonly-v1.0');
  assert.equal(info.threshold, 0.5);
  assert.equal(info.dimension, 8192);
  assert.equal(info.max_batch, 200);
});

console.log(`\nWB01 数值对账:通过 ${pass} / 失败 ${fail}(最大概率偏差 ${worst.toExponential(2)})`);
if (fail) {
  for (const line of failures) console.error('  ✗ ' + line);
  process.exit(1);
}
