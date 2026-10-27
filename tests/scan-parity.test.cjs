// 协同扫描 TS 实现与算法包 coordination_scan.py 的对账。
// 夹具由 scripts/make-scan-fixtures.py 直接调用参考实现生成。
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const scan = require(resolve(__dirname, '..', '.sites-runtime/core-tests/coordination-scan.js'));

const cases = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/scan-cases.json'), 'utf8'));

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

check('normalize 去空白与标点并小写', () => {
  assert.equal(scan.normalize('这事必须严查，转发！'), '这事必须严查转发');
  assert.equal(scan.normalize('Hello, World!'), 'helloworld');
  assert.equal(scan.normalize('  \u3000 '), '');
  assert.equal(scan.normalize('ＡＢＣ'), 'abc'); // NFKC 全角转半角
});

check('grams 生成 2/3-gram', () => {
  assert.deepEqual([...scan.grams('abc')].sort(), ['ab', 'abc', 'bc']);
  assert.deepEqual([...scan.grams('a')], ['a']);
});

check('similarity 边界', () => {
  const cache = new Map();
  assert.equal(scan.similarity('abc', 'abc', cache), 1);
  assert.equal(scan.similarity('', 'abc', cache), 0);
  // 长度比 0.5 < 0.7 直接判 0
  assert.equal(scan.similarity('ab', 'abcd', cache), 0);
});

for (const item of cases) {
  check(`用例 ${item.name}`, () => {
    const prepared = scan.prepareOnlineComments(item.comments);
    const groups = scan.findGroups(prepared.comments, item.parameters.minAccounts, item.parameters.windowMinutes * 60, item.parameters.similarityThreshold);
    assert.equal(groups.length, item.expected.length, `群组数 ${groups.length} != ${item.expected.length}`);
    groups.forEach((group, i) => {
      const expected = item.expected[i];
      assert.deepEqual(group.indices, expected.indices, `第 ${i + 1} 组成员下标`);
      assert.equal(group.representative, expected.representative, `第 ${i + 1} 组代表评论`);
      assert.equal(group.accountCount, expected.accountCount, `第 ${i + 1} 组账号数`);
      assert.equal(group.start, expected.start, `第 ${i + 1} 组开始时间`);
      assert.equal(group.end, expected.end, `第 ${i + 1} 组结束时间`);
      assert.ok(Math.abs(Math.round(group.minSimilarity * 10000) / 10000 - expected.minSimilarity) < 1e-6, `第 ${i + 1} 组最小相似度`);
    });
  });
}

check('在线清洗剔除通用短回复与重复记录', () => {
  const prepared = scan.prepareOnlineComments([
    { accountId: 'u1', text: '支持', publishTime: 1720000000 },
    { accountId: 'u2', text: '这条评论有实际内容需要保留', publishTime: 1720000001 },
    { accountId: 'u2', text: '这条评论有实际内容需要保留', publishTime: 1720000001 },
    { accountId: '', text: '缺少账号', publishTime: 1720000002 },
    { accountId: 'u3', text: '缺少时间' },
  ]);
  assert.equal(prepared.comments.length, 1);
  assert.equal(prepared.skipped.common_short_reply, 1);
  assert.equal(prepared.skipped.duplicate_comment_record, 1);
  assert.equal(prepared.skipped.invalid_field, 2);
});

check('启发式排序分在 0-1 且标记未校准', () => {
  const prepared = scan.prepareOnlineComments(cases[0].comments);
  const groups = scan.findGroups(prepared.comments, 5, 600, 0.82);
  const scored = scan.scoreGroup(groups[0], prepared.comments, 600);
  assert.ok(scored.probability > 0 && scored.probability <= 1);
  assert.equal(scored.accounts.length, 5);
  assert.equal(scored.accounts[0].calibrated, false);
  assert.equal(scored.accounts[0].scoreType, 'heuristic');
});

console.log(`\n协同扫描对账:通过 ${pass} / 失败 ${fail}`);
if (fail) {
  for (const line of failures) console.error('  ✗ ' + line);
  process.exit(1);
}
