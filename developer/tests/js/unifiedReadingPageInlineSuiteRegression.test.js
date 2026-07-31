#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function createSessionStorageStub() {
    const store = new Map();
    return {
        store,
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

function createLocalStorageStub() {
    const store = new Map();
    return {
        store,
        get length() {
            return store.size;
        },
        key(index) {
            return Array.from(store.keys())[index] || null;
        },
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        }
    };
}

function createDocumentStub() {
    const radio = { checked: true, value: 'A' };
    const notes = { value: 'fresh note' };
    return {
        body: {
            dataset: {},
            classList: {
                toggle() {}
            }
        },
        querySelector(selector) {
            if (selector === '#notes-panel textarea') {
                return notes;
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === 'input[type="checkbox"][name]') {
                return [];
            }
            if (selector === 'input[type="radio"][name="q1"]') {
                return [radio];
            }
            return [];
        },
        getElementById() {
            return null;
        },
        addEventListener() {},
        removeEventListener() {}
    };
}

function createContext() {
    const sessionStorage = createSessionStorageStub();
    const localStorage = createLocalStorageStub();
    const document = createDocumentStub();
    const window = {
        location: {
            href: 'http://localhost/assets/generated/reading-exams/reading-practice-unified.html?examId=reading-p1',
            search: '?examId=reading-p1'
        },
        history: { replaceState() {} },
        document,
        sessionStorage,
        localStorage,
        opener: null,
        parent: null,
        addEventListener() {},
        removeEventListener() {},
        scrollTo() {},
        scrollY: 0,
        close() {},
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        HTMLElement: function HTMLElement() {},
        HTMLInputElement: function HTMLInputElement() {},
        HTMLTextAreaElement: function HTMLTextAreaElement() {},
        HTMLSelectElement: function HTMLSelectElement() {}
    };
    window.parent = window;
    const sandbox = {
        window,
        globalThis: window,
        document,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Map,
        Set,
        Promise,
        String,
        Number,
        Boolean,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        HTMLSelectElement: window.HTMLSelectElement,
        sessionStorage,
        localStorage,
        location: window.location
    };
    sandbox.globalThis = window;
    return { context: vm.createContext(sandbox), window, document, sessionStorage, localStorage };
}

function loadHooks() {
    const { context, window, sessionStorage, localStorage } = createContext();
    window.__IELTS_READING_PAGE_TEST_HOOKS__ = true;
    window.__READING_EXAM_MANIFEST__ = {};
    window.__READING_EXAM_DATA__ = new Map();
    loadScript('js/runtime/unifiedReadingPage.js', context);
    const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
    assert(hooks, 'should expose unified reading page test hooks');
    return { hooks, window, sessionStorage, localStorage };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

async function testDraftArbitration() {
    const { hooks } = loadHooks();

    const stale = hooks.mergeDraft(
        { answers: { q1: 'NEW' }, highlights: [{ id: 'new' }], noteText: 'new', scrollY: 9, updatedAt: 3000 },
        { answers: { q1: 'OLD' }, highlights: [{ id: 'old' }], noteText: 'old', scrollY: 1, updatedAt: 1000 }
    );
    assert.deepStrictEqual(plain(stale.answers), { q1: 'NEW' }, 'older draft must not overwrite answers');
    assert.strictEqual(stale.noteText, 'new', 'older draft must not overwrite noteText');
    assert.deepStrictEqual(plain(stale.highlights), [{ id: 'new' }], 'older draft must not overwrite highlights');
    assert.strictEqual(stale.scrollY, 9, 'older draft must not overwrite scrollY');
    assert.strictEqual(stale.updatedAt, 3000, 'older draft must not replace updatedAt');

    const fresh = hooks.mergeDraft(
        { answers: { q1: 'OLD' }, highlights: [{ id: 'old' }], noteText: 'old', scrollY: 1, updatedAt: 1000 },
        { answers: { q1: 'NEW' }, highlights: [{ id: 'new' }], noteText: 'new', scrollY: 9, updatedAt: 3000 }
    );
    assert.deepStrictEqual(plain(fresh.answers), { q1: 'NEW' }, 'newer draft must win answers');
    assert.strictEqual(fresh.noteText, 'new', 'newer draft must win noteText');
    assert.deepStrictEqual(plain(fresh.highlights), [{ id: 'new' }], 'newer draft must win highlights');
    assert.strictEqual(fresh.scrollY, 9, 'newer draft must win scrollY');
    assert.strictEqual(fresh.updatedAt, 3000, 'newer draft must win updatedAt');
}

async function testInlineEnvelopeGuard() {
    const { hooks } = loadHooks();

    hooks.setTestState({
        examId: 'reading-p2',
        sessionId: 'session-new',
        suiteSessionId: 'suite-new',
        sessionReadySent: true,
        suite: {
            inline: true,
            activeExamId: 'reading-p2',
            currentIndex: 1,
            sequence: [
                { examId: 'reading-p1' },
                { examId: 'reading-p2' },
                { examId: 'reading-p3' }
            ],
            slotsByExamId: new Map()
        }
    });

    assert.strictEqual(
        hooks.shouldIgnoreInlineSuiteEnvelope({
            examId: 'reading-p1',
            sessionId: 'session-old',
            suiteSessionId: 'suite-old'
        }),
        true,
        'late INIT/SIMULATION payload for another exam must be ignored'
    );

    assert.strictEqual(
        hooks.shouldIgnoreInlineSuiteEnvelope({
            examId: 'reading-p2',
            sessionId: 'session-old',
            suiteSessionId: 'suite-new'
        }),
        true,
        'late payload with stale sessionId must be ignored once ready'
    );

    assert.strictEqual(
        hooks.shouldIgnoreInlineSuiteEnvelope({
            examId: 'reading-p2',
            sessionId: 'session-new',
            suiteSessionId: 'suite-new'
        }),
        false,
        'current payload must still be accepted'
    );
}

async function testInlineReinitSnapshot() {
    const { hooks, sessionStorage, window } = loadHooks();

    hooks.setTestState({
        examId: 'reading-p1',
        dataKey: 'reading-p1',
        sessionId: 'session-1',
        suiteSessionId: 'suite-1',
        simulationMode: true,
        simulationContextReady: true,
        simulationDraftFingerprint: '',
        lastResults: null,
        suite: {
            inline: true,
            activeExamId: 'reading-p1',
            currentIndex: 0,
            activeStartedAtMs: Date.now() - 5000,
            sequence: [{ examId: 'reading-p1' }],
            slotsByExamId: new Map([
                ['reading-p1', {
                    examId: 'reading-p1',
                    dataKey: 'reading-p1',
                    dataset: { meta: { title: 'P1' } },
                    draft: {
                        answers: { q1: 'OLD' },
                        highlights: [],
                        noteText: 'old note',
                        scrollY: 1,
                        updatedAt: 1000
                    },
                    navStatus: new Map(),
                    lastResults: null,
                    durationSeconds: 0
                }]
            ])
        },
        dataset: { meta: { title: 'P1' }, questionOrder: ['q1'] }
    });

    window.scrollY = 321;

    const draft = hooks.captureInlineSuiteDraftBeforeReinit('reinit');
    assert(draft, 'reinit snapshot should produce a draft');
    assert.deepStrictEqual(plain(draft.answers), { q1: 'A' }, 'current answer must be captured before reinit');
    assert.strictEqual(draft.noteText, 'fresh note', 'current note must be captured before reinit');
    assert.strictEqual(draft.scrollY, 321, 'current scroll position must be captured before reinit');
    assert(draft.updatedAt >= 1000, 'captured draft must carry a fresh updatedAt');

    const state = hooks.getTestState();
    const slotEntry = state.slotsByExamId.find(([examId]) => examId === 'reading-p1');
    assert(slotEntry, 'slot should still exist after snapshot');
    assert.deepStrictEqual(plain(slotEntry[1].draft.answers), { q1: 'A' }, 'slot draft must be updated before reinit');
    assert.strictEqual(slotEntry[1].draft.noteText, 'fresh note', 'slot draft noteText must be updated before reinit');

    const storageKey = 'ielts_sim_draft::suite-1::reading-p1';
    assert(sessionStorage.store.has(storageKey), 'reinit snapshot must persist the local mirror');
    const stored = JSON.parse(sessionStorage.store.get(storageKey));
    assert.deepStrictEqual(plain(stored.draft.answers), { q1: 'A' }, 'persisted mirror must use the captured draft');
}

async function testWindowSessionMessageGuard() {
    const { hooks } = loadHooks();
    const sourceWindow = { name: 'suite-host' };

    hooks.setTestState({
        examId: 'reading-p2',
        sessionId: 'session-new',
        suiteSessionId: 'suite-new',
        parentWindow: sourceWindow,
        windowSessionToken: 'token-new',
        windowSessionIssuedAtMs: 5000,
        lastInitSignature: '',
        simulationCtx: { examId: 'reading-p2', flowMode: 'simulation', currentIndex: 1 },
        suite: {
            inline: true,
            activeExamId: 'reading-p2',
            currentIndex: 1,
            sequence: [
                { examId: 'reading-p1' },
                { examId: 'reading-p2' },
                { examId: 'reading-p3' }
            ],
            slotsByExamId: new Map()
        }
    });

    await hooks.handleIncoming({
        source: sourceWindow,
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'reading-p2',
                sessionId: 'session-new',
                suiteSessionId: 'suite-new',
                windowSessionToken: 'token-old',
                messageIssuedAtMs: 4000
            }
        }
    });

    let state = hooks.getTestState();
    assert.strictEqual(state.lastInitSignature, '', 'stale INIT_SESSION must not overwrite current inline session');
    assert.strictEqual(state.windowSessionToken, 'token-new', 'stale INIT_SESSION must not replace window token');

    await hooks.handleIncoming({
        source: sourceWindow,
        data: {
            type: 'SIMULATION_CONTEXT',
            data: {
                examId: 'reading-p2',
                sessionId: 'session-new',
                suiteSessionId: 'suite-new',
                flowMode: 'simulation',
                currentIndex: 0,
                total: 3,
                windowSessionToken: 'token-old',
                messageIssuedAtMs: 4000,
                suiteSequence: [
                    { examId: 'reading-p1' },
                    { examId: 'reading-p2' },
                    { examId: 'reading-p3' }
                ]
            }
        }
    });

    state = hooks.getTestState();
    assert.strictEqual(state.simulationCtx.currentIndex, 1, 'stale SIMULATION_CONTEXT must not replace active simulation context');

    await hooks.handleIncoming({
        source: sourceWindow,
        data: {
            type: 'INIT_SESSION',
            data: {
                examId: 'reading-p2',
                sessionId: 'session-newer',
                suiteSessionId: 'suite-new',
                windowSessionToken: 'token-newer',
                messageIssuedAtMs: 6000
            }
        }
    });

    state = hooks.getTestState();
    assert.strictEqual(state.sessionId, 'session-newer', 'newer INIT_SESSION must still be accepted');
    assert.strictEqual(state.windowSessionToken, 'token-newer', 'newer INIT_SESSION must adopt the latest window token');
}

async function testWrongReasonSaveVerifiesPersistedRecord() {
    const { hooks, window } = loadHooks();
    const records = [{
        id: 'record-1',
        examId: 'p1-high-230',
        sessionId: 'session-1',
        title: 'Pencil history',
        startTime: '2026-07-27T10:00:00.000Z',
        endTime: '2026-07-27T10:12:00.000Z',
        date: '2026-07-27T10:12:00.000Z',
        duration: 720,
        answerComparison: {
            q10: {
                questionId: 'q10',
                userAnswer: 'nitrogen',
                correctAnswer: 'plants',
                isCorrect: false
            }
        },
        scoreInfo: {
            details: {
                q10: {
                    questionId: 'q10',
                    userAnswer: 'nitrogen',
                    correctAnswer: 'plants',
                    isCorrect: false
                }
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
            if (index >= 0) {
                records[index] = JSON.parse(JSON.stringify(record));
            } else {
                records.unshift(JSON.parse(JSON.stringify(record)));
            }
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.saveWrongReasonsWithPracticeRecordApi({
        recordId: 'record-1',
        sessionId: 'session-1',
        examId: 'p1-high-230',
        dataKey: 'p1-high-230',
        wrongReasons: {
            q10: {
                category: '定位错误',
                note: '答案在后面的一句'
            }
        }
    });

    assert.strictEqual(saved, true, '保存返回对象不完整时，应重新读取记录确认已保存');
    assert.strictEqual(records.length, 1, '错因保存不能创建重复练习记录');
    assert.deepStrictEqual(
        {
            startTime: records[0].startTime,
            endTime: records[0].endTime,
            date: records[0].date,
            duration: records[0].duration
        },
        {
            startTime: '2026-07-27T10:00:00.000Z',
            endTime: '2026-07-27T10:12:00.000Z',
            date: '2026-07-27T10:12:00.000Z',
            duration: 720
        },
        '错因保存不能改原做题时间'
    );
    assert.strictEqual(records[0].wrongReasons.q10.category, '定位错误');
    assert.strictEqual(records[0].wrongReasons.q10.note, '答案在后面的一句');
}

async function testWrongReasonLocalFallbackPrefersCanonicalStorage() {
    const { hooks, localStorage } = loadHooks();
    const originalRecord = {
        id: 'record-local',
        examId: 'p1-high-230',
        sessionId: 'session-local',
        title: 'Pencil history',
        startTime: '2026-07-27T10:00:00.000Z',
        endTime: '2026-07-27T10:12:00.000Z',
        date: '2026-07-27T10:12:00.000Z',
        duration: 720,
        answerComparison: {
            q4: {
                questionId: 'q4',
                userAnswer: 'NOT GIVEN',
                correctAnswer: 'TRUE',
                isCorrect: false
            }
        },
        scoreInfo: {
            details: {
                q4: {
                    questionId: 'q4',
                    userAnswer: 'NOT GIVEN',
                    correctAnswer: 'TRUE',
                    isCorrect: false
                }
            }
        },
        realData: {}
    };

    localStorage.setItem('practice_records', JSON.stringify([]));
    localStorage.setItem('exam_system_practice_records', JSON.stringify({
        version: '0.6.2-fix',
        data: [originalRecord]
    }));

    const saved = hooks.saveWrongReasonsLocally({
        recordId: 'record-local',
        sessionId: 'session-local',
        examId: 'p1-high-230',
        dataKey: 'p1-high-230',
        wrongReasons: {
            q4: {
                category: '定位错误',
                note: 'At one time 曾经'
            }
        },
        updatedAt: '2026-07-27T11:00:00.000Z'
    });

    assert.strictEqual(saved, true, '旧空 practice_records 不能挡住 canonical 记录保存');
    assert.deepStrictEqual(JSON.parse(localStorage.getItem('practice_records')), [], '旧空 key 不应被写入练习错因');
    const stored = JSON.parse(localStorage.getItem('exam_system_practice_records'));
    assert(Array.isArray(stored.data), 'canonical key should keep envelope shape');
    assert.strictEqual(stored.data.length, 1, '错因保存不能新增重复记录');
    assert.strictEqual(stored.data[0].wrongReasons.q4.category, '定位错误');
    assert.strictEqual(stored.data[0].wrongReasons.q4.note, 'At one time 曾经');
    assert.deepStrictEqual(
        {
            startTime: stored.data[0].startTime,
            endTime: stored.data[0].endTime,
            date: stored.data[0].date,
            duration: stored.data[0].duration
        },
        {
            startTime: originalRecord.startTime,
            endTime: originalRecord.endTime,
            date: originalRecord.date,
            duration: originalRecord.duration
        },
        '本地兜底保存错因不能改原做题时间'
    );
}

async function testWrongReasonSyncClearsPendingOnlyAfterVerifiedSave() {
    const { hooks, window } = loadHooks();
    const records = [{
        id: 'record-sync',
        examId: 'p1-high-231',
        sessionId: 'session-sync',
        title: 'Sync save',
        startTime: '2026-07-27T09:00:00.000Z',
        endTime: '2026-07-27T09:18:00.000Z',
        date: '2026-07-27T09:18:00.000Z',
        duration: 1080,
        answerComparison: {
            q4: {
                questionId: 'q4',
                userAnswer: 'NOT GIVEN',
                correctAnswer: 'TRUE',
                isCorrect: false,
                wrongReason: {
                    category: '定位错误',
                    note: 'At one time 曾经'
                }
            }
        },
        scoreInfo: {
            details: {
                q4: {
                    questionId: 'q4',
                    userAnswer: 'NOT GIVEN',
                    correctAnswer: 'TRUE',
                    isCorrect: false,
                    wrongReason: {
                        category: '定位错误',
                        note: 'At one time 曾经'
                    }
                }
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
            assert(index >= 0, '错因同步不能新建重复记录');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    hooks.setWrongReasonTestState({
        examId: 'p1-high-231',
        dataKey: 'p1-high-231',
        sessionId: 'session-sync',
        touchedIds: ['q4'],
        pendingIds: ['q4'],
        lastResults: {
            answerComparison: {
                q4: {
                    questionId: 'q4',
                    userAnswer: 'NOT GIVEN',
                    correctAnswer: 'TRUE',
                    isCorrect: false,
                    wrongReason: {
                        category: '定位错误',
                        note: 'At one time 曾经'
                    }
                }
            },
            scoreInfo: {
                details: {
                    q4: {
                        questionId: 'q4',
                        userAnswer: 'NOT GIVEN',
                        correctAnswer: 'TRUE',
                        isCorrect: false,
                        wrongReason: {
                            category: '定位错误',
                            note: 'At one time 曾经'
                        }
                    }
                }
            }
        }
    });

    const saved = await hooks.syncWrongReasonsNow();
    const saveState = hooks.getWrongReasonSaveState();
    assert.strictEqual(saved, true, '页面侧保存链路必须返回成功');
    assert.deepStrictEqual(saveState.pendingIds, [], '只有读回校验成功后才能清掉未保存状态');
    assert.deepStrictEqual(saveState.touchedIds, [], '保存成功后应清掉已触摸待保存列表');
    assert.strictEqual(records.length, 1, '错因保存不能增加重复记录');
    assert.strictEqual(records[0].wrongReasons.q4.category, '定位错误');
    assert.strictEqual(records[0].wrongReasons.q4.note, 'At one time 曾经');
}

async function testWrongReasonSaveMatchesNumericAndPrefixedQuestionIds() {
    const { hooks, window } = loadHooks();
    const records = [{
        id: 'record-qid',
        examId: 'p1-medium-63',
        sessionId: 'session-qid',
        title: 'A Brief History of Humans and Food',
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
            assert(index >= 0, '数字题号错因保存不能新建重复记录');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    hooks.setWrongReasonTestState({
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        sessionId: 'session-qid',
        lastResults: {
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
            }
        }
    });

    hooks.updateWrongReasonInResults('9', {
        category: '定位错误',
        note: '数字题号也要匹配 q9'
    });
    const saveStateBefore = hooks.getWrongReasonSaveState();
    assert.deepStrictEqual(saveStateBefore.touchedIds, ['q9'], '页面控件题号 9 应映射到记录题号 q9');

    const saved = await hooks.syncWrongReasonsNow();
    const saveStateAfter = hooks.getWrongReasonSaveState();
    assert.strictEqual(saved, true, '数字题号和 q 前缀题号不一致时也必须保存成功');
    assert.deepStrictEqual(saveStateAfter.pendingIds, [], '读回成功后应清掉数字题号未保存状态');
    assert.strictEqual(records.length, 1, '题号映射保存不能新增重复记录');
    assert.strictEqual(records[0].wrongReasons.q9.category, '定位错误');
    assert.strictEqual(records[0].wrongReasons.q9.note, '数字题号也要匹配 q9');
}

async function testWrongReasonSaveFallsBackWhenSessionIdChanged() {
    const { hooks, window } = loadHooks();
    const records = [
        {
            id: 'record-decoy-newer',
            examId: 'p1-medium-63',
            sessionId: 'another-session',
            title: 'A Brief History of Humans and Food',
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
            title: 'A Brief History of Humans and Food',
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
            assert(index >= 0, 'session 不一致时也不能新建重复记录');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.saveWrongReasonsWithPracticeRecordApi({
        sessionId: 'new-review-window-session',
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        wrongReasons: {
            q9: {
                category: '定位错误',
                note: 'session 变化时按题号定位原记录'
            }
        }
    });

    assert.strictEqual(saved, true, 'sessionId 不一致时，应按同篇文章和错题题号回退匹配原记录');
    assert.strictEqual(records.length, 2, '错因保存不能增加重复记录');
    assert.strictEqual(records[0].wrongReasons, undefined, '没有该错题题号的同篇记录不能被误写');
    assert.strictEqual(records[1].wrongReasons.q9.category, '定位错误');
    assert.strictEqual(records[1].wrongReasons.q9.note, 'session 变化时按题号定位原记录');
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
        'session fallback 保存错因不能改原做题时间'
    );
}

async function testWrongReasonSaveFallsBackWhenSuiteSessionIsStale() {
    const { hooks, window } = loadHooks();
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
            assert(index >= 0, 'stale suiteSessionId 不应导致新建重复记录');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.saveWrongReasonsWithPracticeRecordApi({
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

    assert.strictEqual(saved, true, 'stale suiteSessionId 时应继续按同篇文章和题号回退匹配单篇记录');
    assert.strictEqual(records.length, 1, 'stale suite session fallback must not duplicate records');
    assert.strictEqual(records[0].wrongReasons.q9.category, '定位错误');
    assert.strictEqual(records[0].wrongReasons.q9.note, 'stale suite session fallback');
    assert.strictEqual(records[0].duration, 1140, '错因保存不能改原做题时长');
}

async function testWrongReasonSaveDerivesExamIdFromRecordSessionPrefix() {
    const { hooks, window } = loadHooks();
    const records = [{
        id: 'record-session-prefix-only',
        sessionId: 'p1-medium-63_1785165444503_original',
        title: 'A Brief History of Humans and Food 人类食物的历史',
        startTime: '2026-07-27T09:00:00.000Z',
        endTime: '2026-07-27T09:20:00.000Z',
        date: '2026-07-27T09:20:00.000Z',
        duration: 1200,
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
            assert(index >= 0, 'session 前缀匹配必须更新原记录，不能新建');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.saveWrongReasonsWithPracticeRecordApi({
        sessionId: 'p1-medium-63_1785165444503_ruytjstzf',
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        title: 'A Brief History of Humans and Food 人类食物的历史',
        wrongReasons: {
            q9: {
                category: '定位错误',
                note: '由 session 前缀找到原记录'
            }
        }
    });

    assert.strictEqual(saved, true, '记录只有 session 前缀时，也应按 canonical 篇章 ID 找到原记录');
    assert.strictEqual(records.length, 1, 'session 前缀保存不能新增重复记录');
    assert.strictEqual(records[0].examId, 'p1-medium-63', '更新后应补齐 canonical examId');
    assert.strictEqual(records[0].wrongReasons.q9.note, '由 session 前缀找到原记录');
    assert.strictEqual(records[0].duration, 1200, 'session 前缀保存错因不能改原做题时间');
}

async function testWrongReasonSavePrefersCompletedRecordOverFallbackDuplicate() {
    const { hooks, window } = loadHooks();
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
            assert(index >= 0, '错因保存必须更新已有记录');
            records[index] = JSON.parse(JSON.stringify(record));
            return { id: record.id, examId: record.examId };
        }
    };

    const saved = await hooks.saveWrongReasonsWithPracticeRecordApi({
        sessionId: 'p1-medium-63_1785226457635_kov7l84ez',
        reviewSessionId: 'review_ms3jj9ir_74qcnm',
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        title: 'A Brief History of Humans and Food 人类食物的历史',
        wrongReasons: {
            q9: {
                category: '定位错误',
                note: '只更新真实完成记录'
            }
        },
        wrongReasonTargets: [{
            questionId: 'q9',
            userAnswer: 'bacteria',
            correctAnswer: 'glass',
            isCorrect: false
        }]
    });

    assert.strictEqual(saved, true, '错因保存应成功写入真实完成记录');
    assert.strictEqual(records.length, 2, '错因保存不能新增历史记录');
    assert.strictEqual(records[0].wrongReasons.q9.note, '', '空壳重复记录不能被继续更新');
    assert.strictEqual(records[1].wrongReasons.q9.note, '只更新真实完成记录');
    assert.strictEqual(records[1].duration, 1388, '错因保存不能改原用时');
    assert.strictEqual(records[1].accuracy, 0.9230769230769231, '错因保存不能改原正确率');
}

async function testWrongReasonSaveDoesNotCreateRecordWhenTargetMissing() {
    const { hooks, window, localStorage } = loadHooks();
    let apiSaveCalled = false;
    window.PracticeRecordAPI = {
        async list() {
            return [];
        },
        async saveRecord() {
            apiSaveCalled = true;
            throw new Error('saveRecord should not be called without a target record');
        }
    };

    const apiSaved = await hooks.saveWrongReasonsWithPracticeRecordApi({
        recordId: 'missing-record',
        sessionId: 'missing-session',
        examId: 'p1-high-999',
        dataKey: 'p1-high-999',
        wrongReasons: {
            q4: { category: '定位错误', note: '不能新建记录' }
        }
    });

    assert.strictEqual(apiSaved, false, '找不到原记录时 API 路径必须返回失败');
    assert.strictEqual(apiSaveCalled, false, '找不到原记录时不能调用 saveRecord 新增记录');

    localStorage.setItem('exam_system_practice_records', JSON.stringify({ data: [] }));
    const before = localStorage.getItem('exam_system_practice_records');
    const localSaved = hooks.saveWrongReasonsLocally({
        recordId: 'missing-record',
        sessionId: 'missing-session',
        examId: 'p1-high-999',
        dataKey: 'p1-high-999',
        wrongReasons: {
            q4: { category: '定位错误', note: '不能新建记录' }
        }
    });

    assert.strictEqual(localSaved, false, '找不到原记录时本地兜底也必须返回失败');
    assert.strictEqual(localStorage.getItem('exam_system_practice_records'), before, '找不到原记录时不能写出重复记录');
}

async function testWrongReasonSyncUsesUnifiedRecordPathBeforeSqliteDirect() {
    const { hooks, window } = loadHooks();
    let sqliteCalled = false;
    let parentCalled = false;
    let apiCalled = false;

    window.SqlitePracticeBackend = {
        async saveWrongReasons(payload) {
            sqliteCalled = true;
            assert.strictEqual(payload.examId, 'p1-medium-63');
            assert.strictEqual(payload.dataKey, 'p1-medium-63');
            assert.deepStrictEqual(Object.keys(payload.wrongReasons), ['q9']);
            return {
                id: 'record_p1-medium-63_1785155471248_tci4wb41s',
                examId: 'p1-medium-63',
                dataKey: 'p1-medium-63',
                sessionId: 'p1-medium-63_1785155471248_tci4wb41s',
                duration: 1388,
                wrongReasons: {
                    q9: {
                        category: '定位错误',
                        note: 'sqlite direct'
                    }
                },
                answerComparison: {
                    q9: {
                        questionId: 'q9',
                        isCorrect: false,
                        wrongReason: {
                            category: '定位错误',
                            note: 'sqlite direct'
                        }
                    }
                }
            };
        }
    };
    window.opener = {
        savePracticeWrongReasonUpdate(payload) {
            parentCalled = true;
            assert.strictEqual(payload.examId, 'p1-medium-63');
            assert.deepStrictEqual(Object.keys(payload.wrongReasons), ['q9']);
            return {
                id: 'record_p1-medium-63_1785155471248_tci4wb41s',
                examId: 'p1-medium-63',
                dataKey: 'p1-medium-63',
                sessionId: 'p1-medium-63_1785155471248_tci4wb41s',
                duration: 1388,
                wrongReasons: {
                    q9: {
                        category: '定位错误',
                        note: 'unified path'
                    }
                },
                answerComparison: {
                    q9: {
                        questionId: 'q9',
                        isCorrect: false,
                        wrongReason: {
                            category: '定位错误',
                            note: 'unified path'
                        }
                    }
                }
            };
        }
    };
    window.PracticeRecordAPI = {
        async list() {
            apiCalled = true;
            return [];
        },
        async saveRecord() {
            apiCalled = true;
            throw new Error('api path should not be used when sqlite succeeds');
        }
    };

    hooks.setWrongReasonTestState({
        examId: 'p1-medium-63',
        dataKey: 'p1-medium-63',
        sessionId: 'p1-medium-63_new_review_session',
        dataset: {
            meta: {
                title: 'A Brief History of Humans and Food 人类食物的历史'
            }
        },
        lastResults: {
            answerComparison: {
                q9: {
                    questionId: 'q9',
                    userAnswer: 'bacteria',
                    correctAnswer: 'glass',
                    isCorrect: false
                }
            },
            scoreInfo: {
                details: {
                    q9: {
                        questionId: 'q9',
                        userAnswer: 'bacteria',
                        correctAnswer: 'glass',
                        isCorrect: false
                    }
                }
            }
        },
        touchedIds: ['q9'],
        pendingIds: ['q9']
    });
    hooks.updateWrongReasonInResults('q9', {
        category: '定位错误',
        note: 'unified path'
    });

    const saved = await hooks.syncWrongReasonsNow();
    assert.strictEqual(saved, true, '统一记录路径成功时，错因同步应整体成功');
    assert.strictEqual(sqliteCalled, false, '错因同步不应优先绕过 PracticeRecordAPI 直调 SQLite 专用接口');
    assert.strictEqual(parentCalled, true, '错因同步应优先走统一父窗口保存入口');
    assert.strictEqual(apiCalled, false, '父窗口保存成功后不能再走本页 API 兜底');
    assert.deepStrictEqual(hooks.getWrongReasonSaveState().pendingIds, [], '统一路径保存成功后应清除未保存状态');
}

async function main() {
    await testDraftArbitration();
    await testInlineEnvelopeGuard();
    await testInlineReinitSnapshot();
    await testWindowSessionMessageGuard();
    await testWrongReasonSaveVerifiesPersistedRecord();
    await testWrongReasonLocalFallbackPrefersCanonicalStorage();
    await testWrongReasonSyncClearsPendingOnlyAfterVerifiedSave();
    await testWrongReasonSaveMatchesNumericAndPrefixedQuestionIds();
    await testWrongReasonSaveFallsBackWhenSessionIdChanged();
    await testWrongReasonSaveFallsBackWhenSuiteSessionIsStale();
    await testWrongReasonSaveDerivesExamIdFromRecordSessionPrefix();
    await testWrongReasonSavePrefersCompletedRecordOverFallbackDuplicate();
    await testWrongReasonSaveDoesNotCreateRecordWhenTargetMissing();
    await testWrongReasonSyncUsesUnifiedRecordPathBeforeSqliteDirect();
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'unified reading inline suite regressions covered'
    }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
