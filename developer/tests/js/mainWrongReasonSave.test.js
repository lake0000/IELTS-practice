#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadMain(context) {
    const code = fs.readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');
    vm.runInContext(code, context, { filename: 'js/main.js' });
}

function createContext() {
    const listeners = new Map();
    const document = {
        body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {} },
        documentElement: { classList: { add() {}, remove() {}, toggle() {} } },
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {}
    };
    const window = {
        __IELTS_MAIN_TEST_HOOKS__: true,
        document,
        console,
        location: { href: 'http://127.0.0.1:8081/', search: '' },
        history: { replaceState() {}, pushState() {} },
        localStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        sessionStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        removeEventListener(type) {
            listeners.delete(type);
        },
        dispatchEvent() { return true; },
        setTimeout,
        clearTimeout,
        Promise,
        Date,
        JSON,
        Array,
        Object,
        Map,
        Set,
        String,
        Number,
        Boolean,
        Math
    };
    function CustomEvent(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
    }
    const sandbox = {
        window,
        globalThis: window,
        document,
        console,
        setTimeout,
        clearTimeout,
        CustomEvent,
        Promise,
        Date,
        JSON,
        Array,
        Object,
        Map,
        Set,
        String,
        Number,
        Boolean,
        Math
    };
    window.CustomEvent = CustomEvent;
    return vm.createContext(sandbox);
}

async function testMainWrongReasonSaveFallsBackWhenSessionIdChanged() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [
        {
            id: 'record-decoy-newer',
            examId: 'p1-medium-63',
            sessionId: 'another-session',
            endTime: '2026-07-27T10:30:00.000Z',
            date: '2026-07-27T10:30:00.000Z',
            duration: 900,
            answerComparison: {
                q1: {
                    questionId: 'q1',
                    userAnswer: 'A',
                    correctAnswer: 'B',
                    isCorrect: false
                }
            },
            realData: {}
        },
        {
            id: 'record-target-old-session',
            examId: 'p1-medium-63',
            sessionId: 'original-completion-session',
            startTime: '2026-07-27T09:00:00.000Z',
            endTime: '2026-07-27T09:19:00.000Z',
            date: '2026-07-27T09:19:00.000Z',
            duration: 1140,
            answerComparison: {
                q9: {
                    questionId: 'q9',
                    userAnswer: '',
                    correctAnswer: 'glass',
                    isCorrect: false
                }
            },
            scoreInfo: {
                details: {
                    q9: {
                        questionId: 'q9',
                        userAnswer: '',
                        correctAnswer: 'glass',
                        isCorrect: false
                    }
                }
            },
            realData: {}
        }
    ];

    window.PracticeRecordAPI = {
        async list() {
            return records.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async getById(id) {
            const hit = records.find((record) => record.id === id);
            return hit ? JSON.parse(JSON.stringify(hit)) : null;
        },
        async saveRecord(record) {
            const index = records.findIndex((entry) => entry.id === record.id);
            assert(index >= 0, 'main wrong reason save must not create duplicate record');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.savePracticeWrongReasonUpdate({
        sessionId: 'new-review-window-session',
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        wrongReasons: {
            q9: {
                category: '定位错误',
                note: 'main session fallback'
            }
        },
        updatedAt: '2026-07-27T22:11:39.000Z'
    });

    assert.strictEqual(saved.id, 'record-target-old-session', 'main save should choose the record containing the wrong question');
    assert.strictEqual(records.length, 2, 'main save must not add a duplicate record');
    assert.strictEqual(records[0].wrongReasons, undefined, 'newer same-exam decoy without q9 must not be updated');
    assert.strictEqual(records[1].wrongReasons.q9.category, '定位错误');
    assert.strictEqual(records[1].wrongReasons.q9.note, 'main session fallback');
    assert.deepStrictEqual(
        {
            startTime: records[1].startTime,
            endTime: records[1].endTime,
            date: records[1].date,
            duration: records[1].duration
        },
        {
            startTime: '2026-07-27T09:00:00.000Z',
            endTime: '2026-07-27T09:19:00.000Z',
            date: '2026-07-27T09:19:00.000Z',
            duration: 1140
        },
        'main wrong reason save must preserve original completion timing'
    );
}

async function testMainWrongReasonSaveUsesOnlySameExamCandidateWhenSessionChanged() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [{
        id: 'record-only-candidate',
        examId: 'p1-high-194',
        sessionId: 'original-session',
        title: 'Only Candidate',
        startTime: '2026-07-27T08:00:00.000Z',
        endTime: '2026-07-27T08:15:00.000Z',
        date: '2026-07-27T08:15:00.000Z',
        duration: 900,
        realData: {}
    }];

    window.PracticeRecordAPI = {
        async list() {
            return records.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async getById(id) {
            const hit = records.find((record) => record.id === id);
            return hit ? JSON.parse(JSON.stringify(hit)) : null;
        },
        async saveRecord(record) {
            const index = records.findIndex((entry) => entry.id === record.id);
            assert(index >= 0, 'single candidate fallback must not create duplicate record');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.savePracticeWrongReasonUpdate({
        sessionId: 'new-review-session',
        examId: 'p1-high-194',
        title: 'Only Candidate',
        wrongReasons: {
            q4: {
                category: '定位错误',
                note: 'single candidate fallback'
            }
        }
    });

    assert.strictEqual(saved.id, 'record-only-candidate', 'main save should use the only same-exam candidate');
    assert.strictEqual(records.length, 1, 'single candidate fallback must not duplicate records');
    assert.strictEqual(records[0].wrongReasons.q4.note, 'single candidate fallback');
    assert.strictEqual(records[0].duration, 900, 'wrong reason save must preserve duration');
}

async function testMainWrongReasonSaveFallsBackWhenSuiteSessionIsStale() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [{
        id: 'record-single-from-review',
        examId: 'p1-medium-63',
        sessionId: 'original-single-session',
        title: 'A Brief History of Humans and Food',
        endTime: '2026-07-27T09:19:00.000Z',
        date: '2026-07-27T09:19:00.000Z',
        duration: 1140,
        answerComparison: {
            q9: {
                questionId: 'q9',
                userAnswer: '',
                correctAnswer: 'glass',
                isCorrect: false
            }
        },
        realData: {}
    }];

    window.PracticeRecordAPI = {
        async list() {
            return records.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async getById(id) {
            const hit = records.find((record) => record.id === id);
            return hit ? JSON.parse(JSON.stringify(hit)) : null;
        },
        async saveRecord(record) {
            const index = records.findIndex((entry) => entry.id === record.id);
            assert(index >= 0, 'stale suite session fallback must update the existing single record');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.savePracticeWrongReasonUpdate({
        sessionId: 'review-window-session',
        suiteSessionId: 'stale-suite-session',
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        title: 'A Brief History of Humans and Food 人类食物的历史',
        wrongReasons: {
            q9: {
                category: '定位错误',
                note: 'stale suite session fallback'
            }
        }
    });

    assert.strictEqual(saved.id, 'record-single-from-review', 'stale suite session should not block single-record fallback');
    assert.strictEqual(records.length, 1, 'stale suite session fallback must not create a duplicate record');
    assert.strictEqual(records[0].wrongReasons.q9.category, '定位错误');
    assert.strictEqual(records[0].wrongReasons.q9.note, 'stale suite session fallback');
    assert.strictEqual(records[0].duration, 1140, 'wrong reason save must preserve duration');
}

async function testMainWrongReasonSaveRejectsMissingRecordEvenWithTargets() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [];
    window.PracticeRecordAPI = {
        async list() {
            return records.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async getById(id) {
            const hit = records.find((record) => record.id === id);
            return hit ? JSON.parse(JSON.stringify(hit)) : null;
        },
        async saveRecord(record) {
            const index = records.findIndex((entry) => entry.id === record.id);
            if (index >= 0) {
                records[index] = JSON.parse(JSON.stringify(record));
            } else {
                records.unshift(JSON.parse(JSON.stringify(record)));
            }
            return { id: record.id, sessionId: record.sessionId, examId: record.examId };
        }
    };

    await assert.rejects(
        () => hooks.savePracticeWrongReasonUpdate({
            sessionId: 'p1-medium-63_1785175725700_smo81maz8',
            reviewSessionId: 'review_ms3jj9ir_74qcnm',
            examId: 'p1-medium-63',
            dataKey: 'p1-medium-63',
            title: 'A Brief History of Humans and Food 人类食物的历史',
            wrongReasons: {
                q9: {
                    category: '定位错误',
                    note: 'no fallback history record'
                }
            },
            wrongReasonTargets: [{
                questionId: 'q9',
                userAnswer: 'bacteria',
                correctAnswer: 'glass',
                isCorrect: false
            }],
            updatedAt: '2026-07-28T02:08:55.000Z'
        }),
        /找不到可更新的练习记录/
    );

    assert.strictEqual(records.length, 0, 'wrong reason save must not create a practice history record');
}

async function testMainWrongReasonSavePrefersCompletedRecordOverFallbackDuplicate() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [
        {
            id: 'record_p1-medium-63_fallback',
            sessionId: 'p1-medium-63_fallback',
            examId: 'p1-medium-63',
            dataKey: 'p1-medium-63',
            title: 'A Brief History of Humans and Food 人类食物的历史',
            source: 'wrong-reason-fallback',
            date: '2026-07-28T08:14:26.156Z',
            duration: 0,
            totalQuestions: 1,
            score: 0,
            wrongReasons: {
                q9: { category: '定位错误', note: '', updatedAt: '2026-07-28T08:23:26.116Z' }
            },
            answerComparison: {
                q9: { questionId: 'q9', userAnswer: 'bacteria', correctAnswer: 'glass', isCorrect: false }
            },
            metadata: { source: 'wrong-reason-fallback' }
        },
        {
            id: 'record_p1-medium-63_completed',
            sessionId: 'p1-medium-63_completed',
            examId: 'p1-medium-63',
            dataKey: 'p1-medium-63',
            title: 'A Brief History of Humans and Food 人类食物的历史',
            date: '2026-07-27T12:54:19.858Z',
            endTime: '2026-07-27T12:54:19.858Z',
            duration: 1388,
            accuracy: 0.9230769230769231,
            totalQuestions: 13,
            correctAnswers: 12,
            score: 12,
            wrongReasons: {},
            suiteEntries: [],
            answerComparison: {
                q1: { questionId: 'q1', isCorrect: true },
                q9: { questionId: 'q9', userAnswer: 'bacteria', correctAnswer: 'glass', isCorrect: false },
                q13: { questionId: 'q13', isCorrect: true }
            },
            scoreInfo: {
                details: {
                    q9: { questionId: 'q9', userAnswer: 'bacteria', correctAnswer: 'glass', isCorrect: false }
                }
            }
        }
    ];

    window.PracticeRecordAPI = {
        async list() {
            return records.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async getById(id) {
            const hit = records.find((record) => record.id === id);
            return hit ? JSON.parse(JSON.stringify(hit)) : null;
        },
        async saveRecord(record) {
            const index = records.findIndex((entry) => entry.id === record.id);
            assert(index >= 0, 'wrong reason save must update an existing record');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.savePracticeWrongReasonUpdate({
        sessionId: 'p1-medium-63_1785226457635_kov7l84ez',
        reviewSessionId: 'review_ms3jj9ir_74qcnm',
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        title: 'A Brief History of Humans and Food 人类食物的历史',
        wrongReasons: {
            q9: {
                category: '定位错误',
                note: 'update completed record only'
            }
        },
        wrongReasonTargets: [{
            questionId: 'q9',
            userAnswer: 'bacteria',
            correctAnswer: 'glass',
            isCorrect: false
        }]
    });

    assert.strictEqual(saved.id, 'record_p1-medium-63_completed', 'completed history record must beat wrong-reason fallback duplicates');
    assert.strictEqual(records.length, 2, 'wrong reason save must not create another record');
    assert.strictEqual(records[0].wrongReasons.q9.note, '', 'fallback duplicate must not be updated');
    assert.strictEqual(records[1].wrongReasons.q9.note, 'update completed record only');
    assert.strictEqual(records[1].duration, 1388, 'wrong reason update must preserve original duration');
    assert.strictEqual(records[1].accuracy, 0.9230769230769231, 'wrong reason update must preserve original accuracy');
}

async function testMainWrongReasonSaveStillRejectsMissingTargets() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [];
    window.PracticeRecordAPI = {
        async list() {
            return records;
        },
        async getById() {
            return null;
        },
        async saveRecord(record) {
            records.push(record);
            return record;
        }
    };

    await assert.rejects(
        () => hooks.savePracticeWrongReasonUpdate({
            sessionId: 'missing-session',
            examId: 'p1-high-999',
            wrongReasons: {
                q4: {
                    category: '定位错误',
                    note: 'missing target should not create'
                }
            }
        }),
        /找不到可更新的练习记录/
    );
    assert.strictEqual(records.length, 0, 'missing target payload must not create a fallback record');
}

async function testMainWrongReasonSaveDerivesExamIdFromRecordSessionPrefix() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [{
        id: 'record-without-explicit-exam',
        sessionId: 'p1-medium-63_1785165444503_original',
        title: 'A Brief History of Humans and Food 人类食物的历史',
        startTime: '2026-07-27T08:00:00.000Z',
        endTime: '2026-07-27T08:20:00.000Z',
        date: '2026-07-27T08:20:00.000Z',
        duration: 1200,
        answerComparison: {
            q9: {
                questionId: 'q9',
                userAnswer: '',
                correctAnswer: 'glass',
                isCorrect: false
            }
        },
        realData: {
            sessionId: 'p1-medium-63_1785165444503_original'
        }
    }];

    window.PracticeRecordAPI = {
        async list() {
            return records.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async getById(id) {
            const hit = records.find((record) => record.id === id);
            return hit ? JSON.parse(JSON.stringify(hit)) : null;
        },
        async saveRecord(record) {
            const index = records.findIndex((entry) => entry.id === record.id);
            assert(index >= 0, 'session-prefix match must update the existing record');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.savePracticeWrongReasonUpdate({
        sessionId: 'p1-medium-63_1785165444503_ruytjstzf',
        examId: 'p1-medium-63',
        title: 'A Brief History of Humans and Food 人类食物的历史',
        wrongReasons: {
            q9: {
                category: '定位错误',
                note: 'derived from session prefix'
            }
        }
    });

    assert.strictEqual(saved.id, 'record-without-explicit-exam', 'main save should use canonical id derived from record session prefix');
    assert.strictEqual(records.length, 1, 'session-prefix fallback must not create duplicate records');
    assert.strictEqual(records[0].examId, 'p1-medium-63', 'updated record should be normalized with canonical examId');
    assert.strictEqual(records[0].wrongReasons.q9.note, 'derived from session prefix');
    assert.strictEqual(records[0].duration, 1200, 'wrong reason save must preserve original duration');
}

async function testMainWrongReasonSaveUpdatesSuiteAggregateRecord() {
    const context = createContext();
    loadMain(context);
    const { window } = context;
    const hooks = window.__IELTS_MAIN_TEST__;
    assert(hooks, 'main.js should expose wrong reason test hooks');

    const records = [{
        id: 'suite_ms4xfk3v_eed80a',
        sessionId: 'suite_ms4xfk3v_eed80a',
        examId: 'suite-suite_ms4xfk3v_eed80a',
        title: '07月29日套题练习1',
        suiteMode: true,
        suiteEntries: [{
            examId: 'p1-low-02',
            title: 'Maori Fish Hooks 毛利鱼钩',
            duration: 1200,
            wrongReasons: {},
            answerComparison: {
                q10: { questionId: 'q10', userAnswer: 'FALSE', correctAnswer: 'FALSE', isCorrect: true },
                q12: { questionId: 'q12', userAnswer: 'NOT GIVEN', correctAnswer: 'TRUE', isCorrect: false }
            },
            scoreInfo: {
                details: {
                    q10: { questionId: 'q10', userAnswer: 'FALSE', correctAnswer: 'FALSE', isCorrect: true },
                    q12: { questionId: 'q12', userAnswer: 'NOT GIVEN', correctAnswer: 'TRUE', isCorrect: false }
                }
            }
        }],
        answerComparison: {
            'p1-low-02::q10': { questionId: 'q10', userAnswer: 'FALSE', correctAnswer: 'FALSE', isCorrect: true },
            'p1-low-02::q12': { questionId: 'q12', userAnswer: 'NOT GIVEN', correctAnswer: 'TRUE', isCorrect: false }
        },
        scoreInfo: {
            details: {
                'p1-low-02::q10': { questionId: 'q10', userAnswer: 'FALSE', correctAnswer: 'FALSE', isCorrect: true },
                'p1-low-02::q12': { questionId: 'q12', userAnswer: 'NOT GIVEN', correctAnswer: 'TRUE', isCorrect: false }
            }
        },
        duration: 3600,
        accuracy: 0.75,
        date: '2026-07-29T02:36:00.000Z'
    }];

    window.PracticeRecordAPI = {
        async list() {
            return records.map((record) => JSON.parse(JSON.stringify(record)));
        },
        async getById(id) {
            const hit = records.find((record) => record.id === id || record.sessionId === id);
            return hit ? JSON.parse(JSON.stringify(hit)) : null;
        },
        async saveRecord(record) {
            const index = records.findIndex((entry) => entry.id === record.id);
            assert(index >= 0, 'suite wrong reason save must update the existing aggregate record');
            records[index] = JSON.parse(JSON.stringify(record));
            return JSON.parse(JSON.stringify(records[index]));
        }
    };

    const saved = await hooks.savePracticeWrongReasonUpdate({
        recordId: 'suite_ms4xfk3v_eed80a',
        sessionId: 'suite_ms4xfk3v_eed80a',
        suiteSessionId: 'suite_ms4xfk3v_eed80a',
        reviewSessionId: 'review-suite',
        examId: 'p1-low-02',
        dataKey: 'p1-low-02',
        title: 'Maori Fish Hooks 毛利鱼钩',
        wrongReasons: {
            q12: {
                category: '定位错误',
                note: '套题复盘只更新当前文章错因'
            }
        },
        wrongReasonTargets: [{
            questionId: 'q12',
            userAnswer: 'NOT GIVEN',
            correctAnswer: 'TRUE',
            isCorrect: false
        }]
    });

    assert.strictEqual(saved.id, 'suite_ms4xfk3v_eed80a', 'suite replay save should return original aggregate record');
    assert.strictEqual(records.length, 1, 'suite replay save must not create duplicate records');
    assert.strictEqual(records[0].wrongReasons['p1-low-02::q12'].category, '定位错误');
    assert.strictEqual(records[0].answerComparison['p1-low-02::q12'].wrongReason.note, '套题复盘只更新当前文章错因');
    assert.strictEqual(records[0].suiteEntries[0].wrongReasons.q12.note, '套题复盘只更新当前文章错因');
    assert.strictEqual(records[0].duration, 3600, 'suite wrong reason save must preserve aggregate duration');
    assert.strictEqual(records[0].accuracy, 0.75, 'suite wrong reason save must preserve aggregate accuracy');
}

async function main() {
    await testMainWrongReasonSaveFallsBackWhenSessionIdChanged();
    await testMainWrongReasonSaveUsesOnlySameExamCandidateWhenSessionChanged();
    await testMainWrongReasonSaveFallsBackWhenSuiteSessionIsStale();
    await testMainWrongReasonSaveRejectsMissingRecordEvenWithTargets();
    await testMainWrongReasonSavePrefersCompletedRecordOverFallbackDuplicate();
    await testMainWrongReasonSaveStillRejectsMissingTargets();
    await testMainWrongReasonSaveDerivesExamIdFromRecordSessionPrefix();
    await testMainWrongReasonSaveUpdatesSuiteAggregateRecord();
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'main wrong reason save fallback covered'
    }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
