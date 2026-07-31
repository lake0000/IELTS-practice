'use strict';

/**
 * 全量题库记录匹配测试
 * 确保 AnswerComparisonUtils 的全量题库匹配与 metadata 填充逻辑在 Node 环境下可被静态校验。
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AnswerComparisonUtils = require(path.join(__dirname, '..', '..', '..', 'js', 'utils', 'answerComparisonUtils.js'));

const results = [];

function resetGlobalIndexes() {
    delete global.getReadingExamIndex;
    delete global.__READING_EXAM_INDEX__;
    delete global.examIndex;
    delete global.readingExamIndex;
    delete global.listeningExamIndex;
    delete global.fullExamIndex;
    delete global.practiceExamIndex;
}

function setReadingManifestIndex(items) {
    const index = Array.isArray(items) ? items : [];
    global.__READING_EXAM_INDEX__ = index;
    global.getReadingExamIndex = () => index.map((entry) => Object.assign({}, entry));
}

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function assertStrictEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
    }
}

function assertTruthy(value, message) {
    if (!value) {
        throw new Error(message);
    }
}

async function testUrlPathMatching() {
    const testName = 'URL 路径匹配填充 metadata';
    resetGlobalIndexes();

    setReadingManifestIndex([
        {
            id: 'custom_listening_1699999999_0',
            title: 'City Development',
            category: 'P4',
            type: 'listening',
            path: 'ListeningPractice/P4/2. PART4 City Development/',
            frequency: 'high'
        }
    ]);

    const record = {
        examId: 'p4-city-development',
        url: 'file:///tmp/ListeningPractice/P4/2.%20PART4%20City%20Development/2.%20PART4%20City%20Development.html',
        title: 'City Development'
    };

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.examTitle, 'City Development', '应通过路径匹配补齐 examTitle');
    assertStrictEqual(enriched.metadata.category, 'P4', '应通过路径匹配补齐 category');
    assertStrictEqual(enriched.metadata.frequency, 'high', '应透传频次信息');
    assertStrictEqual(enriched.category, 'P4', '记录应同步更新 category');
    assertTruthy(enriched.metadata.__enrichedMetadata, 'metadata 应标记为已填充');

    recordResult(testName, true, { enriched });
}

async function testFuzzyTitleMatching() {
    const testName = '模糊标题匹配带标签前缀';
    resetGlobalIndexes();

    setReadingManifestIndex([
        {
            id: 'custom_listening_1699999999_1',
            title: '[听力全量-2024-11-13] City Development',
            category: 'P4',
            type: 'listening',
            path: 'ListeningPractice/P4/2. PART4 City Development/'
        }
    ]);

    const record = {
        examId: 'unknown_id',
        title: 'City Development'
    };

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.category, 'P4', '应通过模糊标题匹配补齐 category');
    assertStrictEqual(
        enriched.metadata.examTitle,
        '[听力全量-2024-11-13] City Development',
        '应保留索引中的带标签标题'
    );

    recordResult(testName, true, { enriched });
}

async function testCategoryInferenceFromId() {
    const testName = 'examId 中的类别推断';
    resetGlobalIndexes();

    const record = {
        examId: 'custom_reading_p2_section1',
        title: 'Reading drill'
    };

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.category, 'P2', '应从 examId 推断出 P2');
    assertStrictEqual(enriched.category, 'P2', '记录应同步更新推断的 category');

    recordResult(testName, true, { enriched });
}

async function testEnrichedMetadataGuard() {
    const testName = '__enrichedMetadata 重入保护';
    resetGlobalIndexes();

    const record = {
        examId: 'p3-saved-record',
        metadata: {
            category: 'P3',
            examTitle: 'Preserved title',
            frequency: 'weekly',
            __enrichedMetadata: true
        }
    };

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.category, 'P3', '已有 category 不应被覆盖');
    assertStrictEqual(enriched.metadata.examTitle, 'Preserved title', '已有 examTitle 不应被覆盖');
    assertStrictEqual(enriched.metadata.frequency, 'weekly', '已有 frequency 不应被覆盖');
    assertStrictEqual(enriched.metadata.__enrichedMetadata, true, '标记应保持 true');

    recordResult(testName, true, { enriched });
}

async function testUnknownFallbacks() {
    const testName = '无索引信息时的兜底';
    resetGlobalIndexes();

    const record = {};

    const enriched = AnswerComparisonUtils.withEnrichedMetadata(record);

    assertStrictEqual(enriched.metadata.category, 'Unknown', '无线索时 category 应为 Unknown');
    assertStrictEqual(enriched.metadata.frequency, 'unknown', '无频次信息时 frequency 应为 unknown');
    assertStrictEqual(enriched.metadata.examTitle, '未知题目', '无标题时应返回默认 examTitle');

    recordResult(testName, true, { enriched });
}

async function testNormalizedEntriesPreferAnswerDetailsSnapshot() {
    const testName = '逐题明细快照优先于多选组回放字符串';
    resetGlobalIndexes();
    global.AnswerMatchCore = {
        compareAnswers(userAnswer, correctAnswer) {
            return String(userAnswer == null ? '' : userAnswer).trim().toLowerCase()
                === String(correctAnswer == null ? '' : correctAnswer).trim().toLowerCase();
        }
    };
    global.PracticeCore = {
        contracts: {
            resolveRecordCorrectAnswerMap(record) {
                return Object.assign({}, record.correctAnswerMap || {});
            }
        }
    };

    const record = {
        examId: 'p1-medium-57',
        correctAnswerMap: { q9: 'A', q10: 'C', q11: 'C, E, G' },
        answers: [
            { questionId: 'q9', answer: 'A', isCorrect: true },
            { questionId: 'q10', answer: 'C', isCorrect: true },
            { questionId: 'q11', answer: 'C, D, G', isCorrect: false }
        ],
        answerComparison: {
            q9: { userAnswer: 'A, C', correctAnswer: 'A', isCorrect: true },
            q10: { userAnswer: 'A, C', correctAnswer: 'C', isCorrect: true },
            q11: { userAnswer: 'C, D, G', correctAnswer: 'C, E, G', isCorrect: false }
        },
        answerDetails: {
            q9: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true },
            q10: { userAnswer: 'C', correctAnswer: 'C', isCorrect: true },
            q11: { userAnswer: 'C, D, G', correctAnswer: 'C, E, G', isCorrect: false }
        },
        wrongReasons: {
            q11: { category: '题干理解错误', note: 'They are very tiring to put on.' }
        }
    };

    const entries = AnswerComparisonUtils.getNormalizedEntries(record);
    const byKey = Object.fromEntries(entries.map(entry => [entry.canonicalKey, entry]));

    assertStrictEqual(byKey.q9.userAnswer, 'A', 'q9 应显示逐题明细里的单题答案');
    assertStrictEqual(byKey.q9.isCorrect, true, 'q9 应保留提交时正确判定');
    assertStrictEqual(byKey.q10.userAnswer, 'C', 'q10 应显示逐题明细里的单题答案');
    assertStrictEqual(byKey.q10.isCorrect, true, 'q10 应保留提交时正确判定');
    assertStrictEqual(byKey.q11.isCorrect, false, 'q11 应保持错误状态');
    assertStrictEqual(byKey.q11.wrongReason.category, '题干理解错误', 'q11 应带回已保存错因分类');

    recordResult(testName, true, {
        q9: byKey.q9,
        q10: byKey.q10,
        q11: byKey.q11
    });
}

async function runAllTests() {
    const suite = [
        testUrlPathMatching,
        testFuzzyTitleMatching,
        testCategoryInferenceFromId,
        testEnrichedMetadataGuard,
        testUnknownFallbacks,
        testNormalizedEntriesPreferAnswerDetailsSnapshot
    ];

    for (const testFn of suite) {
        try {
            await testFn();
        } catch (error) {
            recordResult(testFn.name || 'unknown', false, { error: error.message });
        }
    }
}

function printJsonReport() {
    const totalTests = results.length;
    const passedTests = results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;

    const output = {
        status: failedTests === 0 ? 'pass' : 'fail',
        detail: `${passedTests}/${totalTests} 测试通过`,
        summary: {
            totalTests,
            passedTests,
            failedTests,
            successRate: `${((passedTests / Math.max(totalTests, 1)) * 100).toFixed(1)}%`,
            timestamp: new Date().toISOString()
        },
        failedTests: results
            .filter(r => !r.passed)
            .map(r => ({ name: r.name, error: r.detail.error }))
    };

    console.log(JSON.stringify(output, null, 2));
    return output;
}

(async function main() {
    try {
        const originalLog = console.log;
        console.log = function noop() {};

        await runAllTests();

        console.log = originalLog;
        const report = printJsonReport();
        process.exit(report.status === 'pass' ? 0 : 1);
    } catch (error) {
        console.error(JSON.stringify({
            status: 'fail',
            detail: `测试执行失败: ${error.message}`,
            error: error.stack
        }, null, 2));
        process.exit(1);
    }
})();
