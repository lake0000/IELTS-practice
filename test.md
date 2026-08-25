# 2026-07-30 测试记录

## 待验证

- 最新记录「The Blockbuster Phenomenon 博物馆爆款现象」刷新后，第 9、10 题应保持提交时的正确状态。
- 练习记录详情、错因表格、点击标题进入复盘页三处应显示一致结果。
- 错因保存到数据库后，重新打开复盘页，对应错题控件应预填已保存的错因分类和备注。
- 修复不应新增重复练习记录，不应改写原始正确率、用时、难度等历史字段。

## 已做检查

- SQLite 最新记录读取成功：`record_p1-medium-57_1785340035149_76traiwwj`。
- 已确认第 9、10 题提交保存时 `answerDetails` 均为正确，聚合正确率 `7/13` 未变。
- 已确认刷新后错判风险来自多选组答案 `A, C` 被作为单题答案再次比较。
- 已确认详情弹窗和复盘页都有重新判题路径，修复后需验证两处都保留提交时的 `isCorrect`。
- 已确认错因控件初始化只从结果项 `wrongReason` 读取，复盘 payload 必须把数据库里的 `wrongReasons` 合并到每道错题结果项。
- `node --check` 已通过：`js/utils/answerComparisonUtils.js`、`js/app/examSessionMixin.js`、`js/runtime/unifiedReadingPage.js`、`js/practice-page-enhancer.js`、`js/components/practiceRecordModal.js`。
- `node developer/tests/js/practicePageEnhancerReplay.test.js` 已通过：8/8。
- `node developer/tests/js/fullLibraryRecordMatching.test.js` 已通过：6/6。
- `node scripts/build-bundles.mjs` 已通过，已重新生成相关 bundle。
- 缓存版本号已从 `20260729-suite-replay-wrongreason` 提升为 `20260730-replay-detail-wrongreason`，避免刷新继续使用旧资源。
- Edge + Playwright 真实页面验证通过：
  - 8081 练习记录页加载 27 条记录，最新卡片仍是「The Blockbuster Phenomenon 博物馆爆款现象」，显示 `54%`、`24分钟`、错因 `5/6`。
  - 练习记录详情表中 Q9 行为 `A / A` 且 `answer-row correct`，Q10 行为 `C / C` 且 `answer-row correct`。
  - 详情表中 Q11 保持错误，并显示已保存错因 `题干理解错误` 和备注。
  - 调用真实回放入口生成的 replay session 中，Q9/Q10 均为正确，Q11 带 `wrongReason`，`scoreInfo` 保持 `7/13 · 54%`。
  - 打开的统一做题页 URL 带 `v=20260730-replay-detail-wrongreason`，结果区显示 `得分 7 / 13 · 54%`；Q9/Q10 为正确，Q11 错因控件预填 `题干理解错误` 与原备注。
- 浏览器插件验证：8081 页面资源版本已更新；练习记录页加载出 27 条 SQLite 记录。
- 电脑操控验证：本会话中 Windows Computer Use Sky runtime 不可用，未能执行窗口级操作；已用浏览器插件和 Edge Playwright 完成替代端到端验证。

# 2026-08-01 完整错题按需导出测试记录

## 已做检查

- `python -m py_compile scripts/local_backup_server.py` 已通过。
- `node --check` 已通过：`js/core/sqlitePracticeBackend.js`、`js/core/practiceRecordAPI.js`、`js/components/practiceHistoryEnhancer.js`、`js/views/legacyViewBundle.js`、`js/main.js`。
- `python developer/tests/python/local_sqlite_backend_test.py` 已通过：新增覆盖 `/api/sqlite/practice-records/full-wrong-export`，验证能导出原文段落、题目、我的答案、标准答案和已标错因。
- `node developer/tests/js/sqlitePracticeBackend.test.js` 已通过：4/4，新增覆盖 `PracticeRecordAPI.exportFullWrongRecords()` 会走 SQLite 后端接口。
- `node scripts/build-bundles.mjs` 已通过，已重新生成相关 bundle。
- 真实 SQLite 数据只读验证通过：最近记录 `record_p1-high-82_1785586384028_ajz9uvyoh` 可按需导出，结果包含 1 篇 passage、5 个原文段落、2 个题组、4 道错题。
- Edge + Playwright 临时 8093 页面验证通过：练习记录页能加载单条“导出”入口；从页面调用 `/api/sqlite/practice-records/full-wrong-export` 返回 `recordCount=1`、`passageCount=1`、`wrongCount=4`。

## 待用户验证

- 启动本地服务后进入练习记录页，点击某条记录右侧“导出”，应下载 `practice_full_wrong_questions_YYYY-MM-DD.json`。
- 导出的 JSON 应包含 `passage`、`questionGroups`、`answers`、`wrongQuestions`，且不会新增或修改任何练习历史记录。

# 2026-08-02 文章解析资源同步测试记录

## 已做检查

- 已执行 `git fetch origin --prune`，原远程 `origin/opensource` 最新增量为 `69b3194`，内容是修复 `p1-high-194` 羊毛产业解析。
- 已确认“澳洲蟾蜍”对应资源：`assets/generated/reading-exams/p1-high-216.js` 和 `assets/generated/reading-explanations/p1-high-216.js`。
- 已验证 `p1-high-216` 原文正文为 7 段，修复后 `passageNotes` 为 7 条：`Paragraph A` 到 `Paragraph G`。
- 已用 JSON 解析脚本验证 `p1-high-194`、`p1-high-216` 解析资源和 `p1-high-216` 题目资源可正常解析。
- 本次只改 generated explanation 数据资源，不涉及 JS 业务逻辑和 bundle。

# 2026-08-02 错因控件锚点错位测试记录

## 已做检查

- `node --check` 已通过：`js/runtime/unifiedReadingPage.js`、`js/runtime/lazyLoader.js`、`js/core/resourceCore.js`、`js/app/examSessionMixin.js`。
- `node scripts/build-bundles.mjs` 已通过，已重新生成 `reading-page.bundle.js`、`runtime-entry.bundle.js`、`core-foundation.bundle.js`、`browse.bundle.js` 等相关 bundle。
- `node developer/tests/js/practicePageEnhancerReplay.test.js` 已通过：8/8。
- Edge + Playwright 临时 8094 验证通过：
  - 打开 `p1-high-211` 新西兰头骨统一阅读页。
  - 只渲染 Q8 的错因控件。
  - 验证 `.reading-inline-wrong-reason[data-question-id="q8"]` 的前一个元素就是 Q8 所在 `.flow-box`。
  - 返回结果：`hasPanel=true`、`panelPreviousIsQ8FlowBox=true`、`panelCount=1`。
- 缓存版本号已提升为 `20260802-wrongreason-anchor`。

# 2026-08-03 词表 SQLite 持久化与展示优化测试记录

## 待验证

- 启动本地服务后，词表应写入 SQLite `meta/vocab_state`，刷新页面后仍能读回。
- 不启动本地服务时，词表仍应走原浏览器存储，不影响背词。
- 外部备份 JSON 应包含 `vocab_state` / `vocabState`，恢复后词表、当前词表、复习队列和设置可恢复。
- 词表 UI 日期只显示年月日；进度字段必须来自现有 SM-2 字段，不能凭空生成。
- 词表同步不能影响练习记录、错因保存、完整错题导出。

## 已做检查

- 已确认 `VocabStore` 当前会把各词表写入浏览器 meta/localStorage：`vocab_words`、`vocab_list_*`、`vocab_user_config`、`vocab_review_queue`、`vocab_active_list_id`。
- 已确认 SQLite 后端已有通用 `meta` 表和 `/api/sqlite/meta/{key}` 读写接口，可用于保存 `vocab_state` 快照。
- 已确认 SM-2 真实字段为 `correctCount`、`repetitions`、`interval`、`easeFactor`、`intraCycles`、`lastReviewed`、`nextReview`；掌握阈值来自 `masteryCount`。
- `node --check` 已通过：`js/core/vocabStore.js`、`js/core/backupAPI.js`、`js/core/sqlitePracticeBackend.js`、`js/components/vocabSessionView.js`。
- `python -m py_compile scripts/local_backup_server.py` 已通过。
- `node developer/tests/js/sqlitePracticeBackend.test.js` 已通过：5/5，新增覆盖 `SqlitePracticeBackend.readVocabState/writeVocabState` 读写 `meta/vocab_state`。
- `python developer/tests/python/local_sqlite_backend_test.py` 已通过，新增覆盖备份中的 `vocab_state` 初始化写入 SQLite meta，并可通过 `/api/sqlite/meta/vocab_state` 读回。
- `node scripts/build-bundles.mjs` 已通过，已重建 `core-foundation.bundle.js`、`more.bundle.js` 等实际页面加载文件。
- 临时 8097 + 系统 Edge Playwright 验证通过：
  - 词表弹窗显示 3610 条默认词表。
  - 表头包含 `正确次数`、`复习轮次`、`间隔`、`上次复习`、`下次复习`。
  - 第一行测试词显示 `正确次数 3`、`复习轮次 3`、`间隔 10 天`、`上次复习 2026/8/3`、`下次复习 2026/8/13`，没有时分秒。
  - `/api/sqlite/meta/vocab_state` 可读回默认词表 3610 条，第一词 `correctCount=3`。
  - `BackupAPI.captureSnapshot()` 同时包含 `vocab_state` 和 `vocabState`，默认词表 3610 条。
  - 词表 meta 预期回退日志已降噪，验证中 `unexpectedVocabMetaWarnings=0`。

# 2026-08-05 阅读页二次高亮测试记录

## 已做检查

- `node --check js/runtime/readingHighlightShared.js` 已通过。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check js/runtime/lazyLoader.js` 已通过。
- `node --check js/app/examSessionMixin.js` 已通过。
- `node --check js/core/resourceCore.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过，已重新生成 `reading-page.bundle.js` 等页面实际加载文件。
- 临时 8098 + 系统 Edge Playwright 验证通过：
  - 在 `p1-medium-63` 原文中选中 `hunter-gatherer ancestors` 后点击 `Highlight`，普通高亮颜色为 `rgb(114, 54, 28)`。
  - 在已有高亮内部选中 `gatherer` 再次点击 `Highlight`，生成 `.hl[data-hl-level="secondary"]`，颜色为 `rgb(230, 59, 134)`。
  - `snapshotHighlights()` 记录二次高亮 `level: "secondary"`。
  - `restoreHighlights()` 后二次高亮仍显示 `rgb(230, 59, 134)`。
- 缓存版本号已提升为 `20260805-secondary-highlight`。

## 待验证

- 用户在实际做题页手动确认手感：选区跨多个 HTML 节点时，如果浏览器无法精确包裹，会按当前命中的旧高亮整体升级为玫红。

# 2026-08-05 套题选项全文判题测试记录

## 已做检查

- 已读取真实 SQLite 最新套题 `suite_msg7hkxw_4fd34d`：
  - 原保存分数：`21/40`。
  - 三篇分别为 `10/13`、`10/13`、`1/14`。
  - 题库 `answerKey` 与记录中的标准答案一致，没有发现标准答案错配。
- 已确认误判项：
  - Q37 用户答案 `B MBA graduates`，标准答案 `B`。
  - Q38 用户答案 `E magic formula`，标准答案 `E`。
  - Q39 用户答案 `G back-to-front thinking`，标准答案 `G`。
  - Q40 用户答案 `I human nature`，标准答案 `I`。
- 修复后用 `AnswerMatchCore` 重算最新套题：`25/40`，三篇分别为 `10/13`、`10/13`、`5/14`。
- 已修复 SQLite 中该条最新套题记录，保留原 `date/duration/title/updatedAt`。
- 修复前数据库已备份到 `E:\hnu\雅思\备份zyz\ielts-atlas.before-suite-judgement-fix-20260805-235902.sqlite`。
- `node --check js/utils/answerMatchCore.js` 已通过。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check js/runtime/lazyLoader.js` 已通过。
- `node developer/tests/js/answerMatchCoreRegression.test.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过。
- 缓存版本号已提升为 `20260805-option-label-judging`。

# 2026-08-06 套题刷新旧分数测试记录

## 已做检查

- SQLite 真实记录 `suite_msg7hkxw_4fd34d` 已补齐一致字段：
  - `score=25`
  - `correctAnswers=25`
  - `totalQuestions=40`
  - `percentage=63`
  - `scoreInfo.correct=25`
  - `answerComparison` 中正确题数 `25/40`
- `/api/sqlite/practice-records/summary` 返回同一记录 `correctAnswers=25`、`percentage=63`。
- `/api/sqlite/practice-records/suite_msg7hkxw_4fd34d` 返回同一记录 `answerCorrect=25`、`answerTotal=40`。
- `node --check` 已通过：`js/main.js`、`js/core/practiceRecordAPI.js`、`js/core/practiceCore.js`、`js/views/legacyViewBundle.js`。
- `python -m py_compile scripts/local_backup_server.py` 已通过。
- `node developer/tests/js/answerMatchCoreRegression.test.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过。
- `node --check` 已通过：`runtime-entry.bundle.js`、`core-foundation.bundle.js`、`browse.bundle.js`、`practice.bundle.js`、`reading-page.bundle.js`。
- 内置浏览器访问 `http://127.0.0.1:8081/?view=practice&verify=suite-score-sync` 验证通过：
  - 最新卡片文本包含 `08月05日套题练习3`。
  - 显示 `错因 0/15`。
  - 显示 `63%`。
  - 页面加载 bundle 版本为 `20260806-suite-score-sync`。

# 2026-08-07 套题回放二次误判测试记录

## 已做检查

- SQLite 后端状态正常，数据库路径为 `E:\hnu\雅思\备份zyz\ielts-atlas.sqlite`，记录数 56。
- 最新套题 `suite_msin6wot_d547e0` 保存结果：
  - 总分 `24/40`，`60%`。
  - `p1-high-118` 为 `10/13`，错题为 Q1、Q3、Q10。
  - `p2-high-09` 为 `11/13`，错题为 Q3、Q5。
  - `p3-high-212` 为 `3/14`，正确题为 Q5、Q6、Q7。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check js/app/examSessionMixin.js` 已通过。
- `node --check js/runtime/lazyLoader.js` 已通过。
- `node --check js/core/resourceCore.js` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖回放保留保存的 `answerComparison.isCorrect`。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- `node --check js/bundles/browse.bundle.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过，已重建实际页面加载 bundle。
- 内置浏览器访问 `http://127.0.0.1:8081/?view=practice&verify=20260807-replay-judgement` 验证通过：
  - 页面加载脚本均为 `20260807-replay-judgement`，旧 `20260806-suite-score-sync` 脚本为 0。
  - 最新套题详情显示 `24/40`、`60%`。
  - P1 Q11-Q13 行为 `answer-row correct`。
  - P2 Q1、Q2、Q4、Q6、Q7、Q8 行为 `answer-row correct`。

# 2026-08-09 错因分类新增测试记录

## 已做检查

- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `python -m py_compile scripts/local_backup_server.py` 已通过，确认保存层语法正常。
- `node scripts/build-bundles.mjs` 已通过，已重建实际页面加载 bundle。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- 已检查源码和 bundle 均包含 `思路错误`、`单词不认识`。
- 已确认后端 `normalize_wrong_reason()` 不限制分类枚举，新分类会作为 `wrongReasons[*].category` 字符串保存。
- 已用临时 SQLite 调用 `PracticeSqliteStore.save_wrong_reasons()` 验证读回：
  - Q1 分类为 `思路错误`。
  - Q2 分类为 `单词不认识`。
  - 匹配方式为 `explicit-id`，未写入真实学习数据库。

# 2026-08-09 原远程阅读题库内容同步测试记录

## 已做检查

- 已从原仓库 `origin` 拉取远程更新，`origin/opensource` 当前为 `b4ee0d9`。
- 已确认本次没有采纳远程逻辑代码，只处理 `assets/generated/reading-exams` 下的数据文件和 manifest 元数据。
- `node --check assets/generated/reading-exams/manifest.js` 已通过。
- 已对同步的文章数据 JS 逐个运行 `node --check`，均通过：
  - `p1-low-84.js`、`p1-medium-115.js`、`p1-high-118.js`、`p1-medium-57.js`
  - `p2-high-131.js`、`p2-high-133.js`、`p2-high-16.js`
  - `p2-low-142.js`、`p2-low-143.js`、`p2-low-148.js`、`p2-low-242.js`、`p2-low-37.js`、`p2-low-50.js`
  - `p2-medium-213.js`、`p2-medium-243.js`
  - `p3-high-15.js`、`p3-high-173.js`、`p3-medium-244.js`
- 已执行 manifest 完整性检查：`entries=234`，所有 `script` 指向的文章 JS 均存在，`missing=[]`。

# 2026-08-10 澳洲野狗逐题解析错位测试记录

## 已做检查

- 已确认 `p2-low-051` 原解析文件 `questionExplanations=[]`，缺少逐题答案/题目翻译/解析。
- 已确认同篇旧编号 `p2-low-140` 有完整逐题解析，题号覆盖 14-26。
- `node --check assets/generated/reading-explanations/p2-low-051.js` 已通过。
- `node --check assets/generated/reading-exams/p2-low-051.js` 已通过。
- 映射一致性检查已通过：
  - 解析 section 数：3。
  - 解析 item 数：13。
  - `missing=[]`。
  - `extra=[]`。
  - `displayMismatches=[]`。
- 根据截图复查段落翻译锚点，确认 `p2-low-051` 的 Paragraph A 在 Paragraph B 标签前有 2 个自然段，旧 `<p>` 顺序锚点会错位。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过，已重建实际页面加载 bundle。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- 已确认 bundle 包含 `READING_PAGE_ASSET_VERSION=20260810-dingo-passage-notes`、`appendAssetVersion()` 和 `.paragraph-label` 段落锚点逻辑。
- 已确认 `p2-low-051` 数据当前为：`labelCount=8`、`passageNotes=8`、`questionExplanationItems=13`。

# 2026-08-10 段落翻译整体错位测试记录

## 已做检查

- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过。
- 新增回归覆盖：
  - `Paragraph A` 有两个自然段时，翻译锚点是 A 段最后一个自然段，不是标题/引言/第一个 `<p>`。
  - `Paragraph 1/2` 数字段落会跳过 `You should spend...` 和纯斜体引言。
- `node scripts/build-bundles.mjs` 已通过，已重建实际页面加载 bundle。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- `node --check js/bundles/runtime-entry.bundle.js` 已通过。
- `node --check js/bundles/core-foundation.bundle.js` 已通过。
- 已确认 `js/bundles/reading-page.bundle.js` 包含：
  - `resolveStandaloneLabelTargets`
  - `resolveInlineLetterTargets`
  - `resolveNumberedParagraphTargets`
  - `READING_PAGE_ASSET_VERSION=20260810-passage-note-targets`

# 2026-08-11 错因多选与直接打开保存测试记录

## 已做检查

- `p3-high-181` 果实之书资源检查通过：题目 JS 和解析 JS 均存在，且 `node --check` 可解析。
- 8081 SQLite 状态检查通过：数据库路径为 `E:\hnu\雅思\备份zyz\ielts-atlas.sqlite`，服务可用。
- 真实 SQLite 记录查询确认：当前没有 `p3-high-181 / The Fruit Book / 果实之书` 完成记录，因此旧版本错因保存没有可更新目标。
- `node --check` 已通过：`js/runtime/unifiedReadingPage.js`、`js/main.js`、`js/runtime/lazyLoader.js`、`js/core/resourceCore.js`、`js/app/examSessionMixin.js`。
- `python -m py_compile scripts/local_backup_server.py` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖：
  - 错因可保存多个分类，payload 包含完整 `categories`。
  - 直接打开统一阅读页提交、没有父窗口接收消息时，会调用 `PracticeRecordAPI.saveCompletion()` 保存完成记录。
- `node developer/tests/js/mainWrongReasonSave.test.js` 已通过，新增覆盖主页保存链路保留多个错因分类且不新增重复记录。
- `node scripts/build-bundles.mjs` 已通过。
- `node --check` 已通过：`js/bundles/reading-page.bundle.js`、`js/bundles/browse.bundle.js`、`js/bundles/core-foundation.bundle.js`、`js/bundles/runtime-entry.bundle.js`。
- 已确认新缓存版本 `20260811-wrongreason-multiselect-save` 写入 `index.html`、统一阅读页 HTML、`reading-page.bundle.js`、`runtime-entry.bundle.js`。

## 待用户验证

- 在 8081 页面硬刷新后重新打开果实之书；URL 应使用新版本号或从主页入口打开。
- 做完提交后回到练习历史，应出现一条有用时、正确率和题目明细的正式记录。
- 在错题旁选择多个错因并保存，刷新/重新打开后应仍显示多个分类，不应新增一条 0 秒/0% 的错因空记录。

# 2026-08-12 PDF 401、错因控件样式、套题频率筛选测试记录

## 已做检查

- 已确认 `Scented Plants 植物的味道` 是 `p1-low-67`，manifest 频率为 `low`，PDF 清单路径为 `ReadingPractice/PDF/159. P1 - Scented Plants 植物的味道.pdf`。
- 已确认当前仓库没有 `ReadingPractice/PDF` 实体目录；8081 本地该 PDF 路径返回 `404`。
- 8081 统一阅读页检查通过：`p1-low-67` 页面返回 `200`，并包含缓存版本 `20260812-suite-frequency-ui-fix`。
- `node --check` 已通过：`js/runtime/unifiedReadingPage.js`、`js/app/examActions.js`、`js/app/state-service.js`、`js/app/suitePracticeMixin.js`。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖：错因复选框不会被标记为错误作答控件。
- `node developer/tests/js/suiteModeRegression.test.js` 已通过，新增覆盖：
  - “仅高频”自动套题未做题不足时，只在高频范围内放宽为已做题，不混入低频。
  - 自选套题状态层拒绝低频文章写入“仅高频”草稿。
- `node scripts/build-bundles.mjs` 已通过，实际加载 bundle 已重建。
- `node --check` 已通过：`js/bundles/reading-page.bundle.js`、`js/bundles/browse.bundle.js`、`js/bundles/core-foundation.bundle.js`、`js/bundles/session.bundle.js`、`js/bundles/runtime-entry.bundle.js`。
- `git diff --check` 仅提示 CRLF/LF 换行警告，无新增空白错误。
- 原远程 PDF 资源检查通过：`git ls-tree -r --name-only origin/opensource` 和 `git lfs ls-files` 未发现 `.pdf`、`ReadingPractice/PDF` 或 PDF 压缩包。
- 原远程频率标签对比通过：本地/远程均有 234 篇，频率字段差异 13 篇，`p1-low-67` 仍为 `low`。
- `node --check` 已通过：`js/utils/suitePreference.js`、`js/app/suitePracticeMixin.js`、`js/app/examActions.js`、`js/app/state-service.js`。
- `node developer/tests/js/suiteModeRegression.test.js` 已通过，新增覆盖：仅高频自动套题不得混入低频或未知频率文章；仅高频自选状态层不得接受未知频率文章。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过，实际加载 bundle 已重建。
- `node --check` 已通过：`js/bundles/runtime-entry.bundle.js`、`js/bundles/session.bundle.js`、`js/bundles/browse.bundle.js`、`js/bundles/core-foundation.bundle.js`、`js/bundles/reading-page.bundle.js`。

# 2026-08-15 表格题错因控件错位测试记录

## 已做检查

- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖：表格题错因控件必须插入为整行 `<tr>`，且 `td.colSpan` 覆盖整张匹配表。
- `node scripts/build-bundles.mjs` 已通过。
- `node --check` 已通过：`js/bundles/reading-page.bundle.js`、`js/bundles/runtime-entry.bundle.js`、`js/bundles/core-foundation.bundle.js`。
- 8081 页面检查通过：`p2-low-50` 新 URL 返回 200，并包含 `20260815-table-inline-review`。
- Playwright + 本机 Edge 页面验证通过：
  - `pageVersion=true`。
  - 插入行 `insertedTag=TR`。
  - 插入行 `insertedClass=reading-inline-wrong-reason-row`。
  - `insertedColSpan=8`。
  - `q15StillTableRow=true`。
  - `directDivChildrenInTbody=0`。

# 2026-08-19 回顾页解析错位、二次高亮、错因空格和卡顿测试记录

## 已做检查

- 已确认 `p1-high-200`「Australia's Airborne Dentists 澳洲飞行牙医」原文正文有 10 个自然段，旧解析文件只有 5 条合并 `passageNotes`，并且使用 `Paragraph A..E`，这是牙医篇翻译错位的直接数据原因。
- 已确认 `p1-high-200` 题库答案 13 题和逐题解析 13 题完全覆盖：`missing=[]`，`extra=[]`。
- 已确认通用风险：部分解析资源的 `passageNotes` 数量或 label 与原文目标不一致；旧顺序兜底会把翻译插到错误段落后。
- 已修复 `p1-high-200` 解析文件为 10 条 `Paragraph 1..10` 段落翻译。
- 已修复 `resolvePassageTargets()`：结构化 label 找不到一一对应锚点时不再顺序硬插；无标签 notes 数量与自然段目标数量不一致时退到整组“原文翻译”展示。
- 已修复二次高亮：当前选区用内层 `.hl[data-hl-level="secondary"]` 包住，不再把已有整段 `.hl` 升级为 secondary。
- 已修复 `.wrong-reason-note` 空格输入：备注框键盘事件不再冒泡到页面级快捷键。
- 已排查卡顿来源：`reading-page.bundle.js` 同步打入约 5MB 的 ECDICT 词典。已改为回顾高亮查词时按需加载，打包后 `reading-page.bundle.js` 为 `1046318` bytes，`ecdict_reading.bundle.js` 保持独立 `5249836` bytes。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check js/runtime/reviewHighlightDictionary.js` 已通过。
- `node --check js/core/dictionaryService.js` 已通过。
- `node --check developer/tests/js/readingPageReviewFix.playwright.test.js` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，覆盖段落翻译不可靠映射不再错位硬插。
- `node scripts/build-bundles.mjs` 已通过，实际加载 bundle 已重建。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- `node --check js/bundles/core-foundation.bundle.js` 已通过。
- Playwright + 本机 Edge 验证通过：
  - 8081 统一阅读页返回 200，HTML 包含 `20260819-highlight-control-guard`。
  - `p1-high-200` 提交回顾后生成 10 条段落翻译，第一条 `Paragraph 1`，最后一条 `Paragraph 10`。
  - 错因备注可以输入并保留 `space works` 中的空格。
  - 先高亮 `alpha beta gamma`，再只选 `beta` 二次高亮，DOM 为 `<span class="hl">alpha <span class="hl" data-hl-level="secondary">beta</span> gamma</span>`，外层未变为 secondary。

## 注意

- in-app browser 新建受控页本次出现 attach 超时，已改用本机 Edge 的 Playwright 自动化验证。
- 用户浏览器若仍显示旧行为，需要硬刷新或重新从主页打开，确认 URL/脚本版本为 `20260819-highlight-control-guard`。

# 2026-08-19 复盘打开产生 0 秒记录清理测试记录

## 已做检查

- 已导出清理前快照：`exports/records-snapshot-before-cleanup-20260819.json`。
- 已筛选并确认 4 条疑似自动验证误写入记录，特征完全一致：
  - `record_1787125953142_o461rw`：`p1-low-116`，2026-08-19 15:52:33，本地显示用时 1 秒，0/13。
  - `record_1787125949188_fuka7r`：`p1-high-200`，2026-08-19 15:52:29，本地显示用时 1 秒，0/13。
  - `record_1787125845536_zp723r`：`p1-low-116`，2026-08-19 15:50:45，本地显示用时 1 秒，0/13。
  - `record_1787125770364_6c6bn1`：`p1-low-116`，2026-08-19 15:49:30，本地显示用时 1 秒，0/13。
- 已通过 `POST /api/sqlite/practice-records/delete` 删除上述 4 条，返回 `deletedCount=4`。
- 删除后重新读取 `/api/sqlite/practice-records`，上述 ID 均不存在。
- 已修复 `saveStandalonePracticeCompletion()`：`reviewMode`、`suiteReviewMode`、`suite.inline`、`simulationMode`、`payload.suiteSubmission` 不会触发单篇完成保存兜底。
- 已修复 `developer/tests/js/readingPageReviewFix.playwright.test.js`：页面初始化阶段 stub `PracticeRecordAPI`，并拦截 SQLite 写接口。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check developer/tests/js/readingPageReviewFix.playwright.test.js` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖 `reviewMode` 下调用提交函数不得创建 standalone completion。
- `node scripts/build-bundles.mjs` 已通过。
- Playwright + 本机 Edge 验证通过；验证后再次读取真实后端，今天 0 秒/0%/10题以上疑似记录数量为 `0`。

# 2026-08-19 错因控件高亮污染测试记录

## 已做检查

- 已确认截图里的棕红色块是阅读高亮 `.hl` 误恢复到错因控件区域，不是错因分类选项的正常样式。
- 根因：`readingHighlightShared.js` 计算高亮文本流时只排除了解析卡，没有排除 `.wrong-reason-controls`；复盘页插入错因控件后，旧高亮快照的 `start/end` 偏移会被控件文字扰动。
- 已修复高亮恢复：
  - 文本节点收集、快照和恢复排除错因控件、内联错因行和解析卡。
  - 已有残留在错因控件里的 `.hl` 会在恢复前解包，不保留色块。
  - 有 `before/after` 上下文时，`start/end` 位置必须同时匹配文字和上下文；位置不匹配时按文字上下文重新搜索。
- `node --check js/runtime/readingHighlightShared.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- Playwright + 本机 Edge 验证通过：
  - 错因控件内同样有 `alpha beta gamma` 时，高亮只恢复到题目内容，`.wrong-reason-controls .hl` 数量为 `0`。
  - 同一段文字出现两次、旧 `start/end` 指向错误位置时，恢复会按 `before/after` 上下文命中正确段落。
  - 验证后真实后端今天 0 秒/0%/10题以上疑似记录数量仍为 `0`。

# 2026-08-20 洪水防控错因保存与摘要字段测试记录

## 已做检查

- 已确认文章 `Keeping the water away 洪水防控` 对应 `p2-low-37`。
- 已读取真实 SQLite：数据库路径为 `E:\hnu\雅思\备份zyz\ielts-atlas.sqlite`，记录总数 74。
- 已确认最新记录 `record_p2-low-37_1787185449487_w37skvu1w` 存在，真实答题结果为 `11/13`、`accuracy=0.8461538461538461`。
- 已确认该记录已有 Q2、Q3 错因：
  - Q2：`同义替换没看出`，备注 `was isolated from its flood plain和cut it off from its plain`。
  - Q3：`原文理解错误`、`单词不认识`，备注包含 `natural watercourses`。
- 已确认异常原因：同一条记录里 `percentage=0` 且轻量 `scoreInfo` 为空，导致列表/回显可能读到 0% 或像保存失败；不是新增了一条目标记录，也不是后端和浏览器冲突。
- `node --check js/core/practiceCore.js` 已通过。
- `node --check js/core/practiceRecordAPI.js` 已通过。
- `python -m py_compile scripts/local_backup_server.py` 已通过。
- `node developer/tests/js/practiceCore.test.js` 已通过：17/17，新增覆盖多选错因 `categories` 不丢失、`percentage=0` 不覆盖真实 `11/13`。
- `node developer/tests/js/sqlitePracticeBackend.test.js` 已通过：5/5。
- `node scripts/build-bundles.mjs` 已通过，实际加载 bundle 已重建。
- 缓存版本已提升到 `20260820-wrongreason-score-summary`。
- 临时 8098 服务只读验证通过：`/api/sqlite/practice-records/summary` 返回 `p2-low-37` 为 `85% / 11/13`，`scoreInfo.percentage=85`，Q2/Q3 错因存在。
- 已重启 8081 本地服务；`GET /api/sqlite/status` 返回 `ok=true`、记录数 74。
- 8081 实际摘要验证通过：`p2-low-37` 返回 `85% / 11/13`，`wrongReasonKeys=["q2","q3"]`。

## 注意

- 8081 当前正在运行的 Python 服务若未重启，仍会使用旧后端代码。需要重启 8081 后，后端摘要修复才会在当前页面生效。

# 2026-08-20 巨兽灭绝选项排版测试记录

## 已做检查

- 已确认 `Australia’s Megafauna Controversy 巨兽灭绝` 对应 `p3-medium-197`。
- 已确认 Q36-Q40 的题目数据使用旧式 `.options > label` 结构；旧统一样式没有覆盖 `.options label`，导致选项行内排列。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖旧 `.options` 结构必须进入块状选项布局。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- `node --check js/runtime/lazyLoader.js` 已通过。
- `node scripts/build-bundles.mjs` 已通过，缓存版本提升到 `20260820-megafauna-options-layout`。
- 8081 新版 URL 验证通过：页面返回 200，HTML 包含 `.options label`、`.options label input[type="radio"]` 和新版本号。
- Playwright + 本机 Edge 验证通过：`p3-medium-197` Q36 共有 4 个 `.options label`，计算样式均为 `display:flex`，相邻选项纵向间距约 36px。

# 2026-08-22 湖泊海啸研究错因控件错位测试记录

## 已做检查

- 已读取 8081 SQLite 状态：数据库路径 `E:\hnu\雅思\备份zyz\ielts-atlas.sqlite`，记录数 77。
- 已定位最新套题 `suite_mt3wnjc9_ae925a`，P1 文章为 `p1-low-223 Effect and Cause 湖泊海啸研究`。
- 已确认该文章错题为 Q1、Q4、Q7、Q10；Q10 是 flow-chart 填空题。
- 已确认 DOM 结构：Q1/Q4/Q7 的真实题目容器为 `.question-block`，Q10 的真实题目容器为 `.flowchart-item`。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- `node --check developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖 `.question-block` 和 `.flowchart-item` 错因面板插入锚点。
- `node scripts/build-bundles.mjs` 已通过，缓存版本提升到 `20260822-wrongreason-question-host`。
- 8081 新版 URL 验证通过：`p1-low-223` 页面返回 200，HTML 包含新版本号。
- Playwright + 本机 Edge 验证通过：Q1/Q4/Q7 的错因面板前一个兄弟节点分别是 `q1-anchor/q4-anchor/q7-anchor.question-block`；Q10 的前一个兄弟节点是 `.flowchart-item`；所有面板均不在 `label`、`.flowchart-item` 或 `.question-block` 内部。

# 2026-08-25 最新三套复盘错位与详细解析补全测试记录

## 已做检查

- 已从 8081 SQLite API 读取最近三套记录：
  - `08月25日套题练习2`：`p1-low-13`、`p2-high-232`、`p3-medium-169`。
  - `08月25日套题练习1`：`p1-low-113`、`p2-medium-10`、`p3-high-156`。
  - `08月24日套题练习1`：`p1-low-80`、`p2-high-133`、`p3-high-173`。
- 已检查上述 9 篇文章的解析资源，确认只有 `p2-high-232`、`p3-medium-169` 缺逐题详细解析；9 篇标准答案均存在。
- 已检查对应 PDF：`p2-high-232` PDF 文本提取不可用，`p3-medium-169` PDF 只有原文；本次详细解析按当前题库原文与标准答案构建。
- `node --check js/runtime/unifiedReadingPage.js` 已通过。
- `node --check js/bundles/reading-page.bundle.js` 已通过。
- `node --check developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过。
- `node --check assets/generated/reading-explanations/p2-high-232.js` 已通过。
- `node --check assets/generated/reading-explanations/p3-medium-169.js` 已通过。
- `node developer/tests/js/unifiedReadingPageInlineSuiteRegression.test.js` 已通过，新增覆盖：
  - `.diagram-input-item` 作为图表题单题宿主。
  - 同一段落内多个错因控件保持 q10、q11 顺序。
  - `.paragraph-wrapper` / `Section A` 段落翻译插入到 wrapper 最后一个正文段后。
- `node scripts/build-bundles.mjs` 已通过，缓存版本提升到 `20260825-latest-suite-review-fix`。
- 8081 新版页面验证通过：`reading-practice-unified.html` 返回 200，页面包含新版本号。
- Playwright + 本机 Edge 验证最近三套 9 篇文章：每篇错因控件数量与错题号一致，且 `structuralBad=[]`，没有插入 `label`、输入控件或整个 `.unified-group` 后。
- Playwright 验证 `p3-medium-169` 段落翻译锚点：A-E 均命中对应 `.paragraph-wrapper` 的末尾正文段。
