#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const fixedNow = new Date('2026-07-26T12:00:00+08:00');

class FixedDate extends Date {
    constructor(...args) {
        if (args.length === 0) {
            super(fixedNow.getTime());
        } else {
            super(...args);
        }
    }

    static now() {
        return fixedNow.getTime();
    }
}

const sandbox = {
    window: {},
    console,
    Date: FixedDate,
    Math,
    JSON,
    Set,
    Array,
    Number,
    String,
    isNaN,
    isFinite
};
sandbox.window = sandbox;

const context = vm.createContext(sandbox);
const source = fs.readFileSync(path.join(repoRoot, 'js/views/legacyViewBundle.js'), 'utf8');
vm.runInContext(source, context, { filename: 'js/views/legacyViewBundle.js' });

const PracticeStats = sandbox.PracticeStats;
assert(PracticeStats, 'PracticeStats should be exported');

const summary = PracticeStats.calculateSummary([
    {
        id: 'local-night-25',
        examId: 'local-night-25',
        title: 'Local Night 25',
        type: 'reading',
        date: '2026-07-24T17:30:00.000Z',
        duration: 600,
        accuracy: 1
    },
    {
        id: 'local-night-26',
        examId: 'local-night-26',
        title: 'Local Night 26',
        type: 'reading',
        date: '2026-07-25T17:30:00.000Z',
        duration: 600,
        accuracy: 1
    }
]);

assert.strictEqual(
    summary.streak,
    2,
    '连续天数应按本地日期计算，晚上做题不能被 UTC 日期打断'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'PracticeStats 本地日期连续天数测试通过',
    streak: summary.streak
}, null, 2));
