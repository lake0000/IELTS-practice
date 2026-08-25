# 2026-07-30 多选题回放与错因回显修复计划

## 目标

修复最新练习记录「The Blockbuster Phenomenon 博物馆爆款现象」刷新后第 9、10 题从正确变成错误的问题，并修复错因已保存到数据库但重新打开做题页不回显的问题。

## 步骤

- [x] 建立本次排查记录文件。
- [x] 定位最新练习记录在 SQLite 中的原始 payload，确认提交时保存的答案、正确答案、得分详情。
- [x] 对照题库文件，确认第 9、10 题的题型、答案结构和标准答案格式。
- [x] 定位刷新/复盘页使用哪条判题路径，找出为什么保存后的结果会被重新解释。
- [x] 定位错因保存后的读回路径，找出为什么数据库有错因但复盘页控件没有预填。
- [ ] 实施最小代码修复，避免新增重复中转逻辑。
- [x] 增加针对多选题回放稳定性和错因回显的回归测试。
- [x] 运行 JS/Python 测试、打包，并通过浏览器/Playwright/电脑操控做端到端验证。

# 2026-08-01 完整错题按需导出计划

## 目标

新增一个只在用户主动选择记录时生成的完整错题导出功能。数据库继续保存轻量练习记录，不在每次做题完成时写入原文和完整题目，避免性能下降和记录膨胀。

## 步骤

- [x] 确认完整导出应挂在本地 SQLite 服务，而不是浏览器端长期保存重字段。
- [x] 新增本地服务接口，按记录 ID 临时读取题库文件并合并原文、题组、作答、标准答案、错题和错因。
- [x] 在前端统一记录 API 中接入该接口，缺少本地服务时给出明确提示。
- [x] 在练习记录页添加单条记录导出入口，并在导出弹窗新增“完整错题 JSON”格式。
- [x] 补充 Python/JS 回归测试并重建 bundle。
- [x] 用真实 SQLite 数据做只读导出验证。

# 2026-08-02 文章解析资源同步计划

## 目标

只更新文章/解析资源，不改做题、判题、错因保存和练习历史逻辑。

## 步骤

- [x] 从原远程 `origin/opensource` 拉取最新提交。
- [x] 筛选远程更新范围，确认这次原远程只更新了 `p1-high-194` 羊毛产业解析。
- [x] 定位“澳洲蟾蜍”对应资源为 `p1-high-216`。
- [x] 修正 `p1-high-216` 解析段落翻译错位：正文 7 段对应 7 条 `passageNotes`。
- [x] 验证资源文件可解析，且不需要重建 bundle。

# 2026-08-02 错因控件锚点错位修复计划

## 目标

修复复盘页内联错因控件总是插到错误题目附近的问题，尤其是 flow-chart / flow-box 这类题型。

## 步骤

- [x] 根据截图定位示例文章为 `p1-high-211` 新西兰头骨。
- [x] 确认错位原因：错因控件寻找题目容器时不识别 `.flow-box`，在题组内误选了其他题的解析卡或整个 group。
- [x] 修复题目锚点和错因控件 host 选择逻辑，优先匹配同题 `data-question-id` 解析卡，并支持 `.flow-box`。
- [x] 提升资源版本号，避免统一阅读页继续加载旧 bundle。
- [x] 重建 bundle 并用 Edge + Playwright 验证 Q8 错因控件紧跟 Q8 flow-box。

# 2026-08-03 词表 SQLite 持久化与展示优化计划

## 目标

让词表进度不只停留在浏览器存储里，而是同步保存到本地 SQLite 后端；手动/外部备份也要包含词表快照，方便换浏览器或恢复。词表 UI 只展示和现有 SM-2 复习算法一致的真实字段，日期精确到天。

## 步骤

- [x] 确认当前词表存储链路：`VocabStore` 运行态 + 浏览器 meta/localStorage，SQLite 只已有练习记录和通用 meta。
- [x] 确认复习算法字段：`correctCount`、`repetitions`、`interval`、`easeFactor`、`intraCycles`、`lastReviewed`、`nextReview`、`masteryCount`。
- [x] 明确 `定位.md`、`plan.md`、`test.md`、`notice.md` 的职责边界。
- [x] 在 SQLite `meta` 中保存 `vocab_state` 快照，并让 `VocabStore` 启动时优先读取后端快照。
- [x] 将 `BackupAPI` 纳入词表快照，恢复时同步写回浏览器存储和 SQLite。
- [x] 优化词表 UI 字段和日期展示，不显示时分秒。
- [x] 增加 JS/Python 回归测试，重建 bundle，并用浏览器验证链路。

# 2026-08-05 阅读页二次高亮计划

## 目标

仿照真实考场：普通高亮后，再次选中已高亮文字并点击 `Highlight`，二次选区显示玫红色，并且刷新/回放恢复时保持该颜色。

## 步骤

- [x] 定位阅读页选区工具栏和高亮快照保存位置。
- [x] 为高亮快照新增二次高亮层级字段，保持旧数据兼容。
- [x] 修改 `Highlight` 按钮行为：已有高亮内再次高亮时生成玫红二次高亮。
- [x] 补充统一阅读页浅色/深色模式样式。
- [x] 重建 bundle 并做语法检查。
- [x] 浏览器自动验证：一次高亮为棕色，二次高亮为玫红色，快照恢复后仍为玫红色。

# 2026-08-19 回顾页错位、二次高亮和错因输入修复计划

## 目标

修复回顾页中段落翻译/题目解析经常插错位置的问题，先处理已确认的 `p1-high-200`「Australia's Airborne Dentists 澳洲飞行牙医」数据错位，同时收紧通用插入逻辑，避免数量不匹配的段落翻译被硬插到错误段落后。同步修复二次高亮只选单词却整句变玫红、错因备注无法输入空格，并排查页面卡顿的直接原因。

## 步骤

- [x] 确认当前工作区和维护文档职责，避免覆盖已有 practice 分支改动。
- [x] 定位「牙医」文章为 `p1-high-200`，确认原文正文 10 段但 `passageNotes` 只有 5 条，属于数据错位源头。
- [x] 定位回顾页段落翻译、题目解析、错因控件插入的通用逻辑，找出会把内容插到错误题目/段落后的条件。
- [x] 修复段落翻译插入策略：只有标签和目标能一一匹配时才逐段插入；不可靠时改为整组展示，避免错误贴到某段。
- [x] 修复 `p1-high-200` 段落翻译数据，使 10 段原文对应 10 条翻译。
- [x] 修复二次高亮只作用于当前选区，不再把整个已有高亮节点升级为玫红。
- [x] 修复错因备注输入空格被页面快捷键拦截的问题。
- [x] 排查卡顿来源，确认做题页同步打包了 5MB 级 ECDICT 词典；改为回顾查词时按需加载，阅读页 bundle 从约 6.3MB 降到约 1.05MB。
- [x] 重建 bundle，运行针对错位/高亮/错因输入的回归测试和浏览器验证。

# 2026-08-19 复盘打开产生 0 秒记录清理与防复发计划

## 目标

清理本次自动验证误写入真实 SQLite 的 0 秒/0% 临时记录，并修复统一阅读页完成保存兜底条件，避免从套题错题回顾、复盘页或只读页面打开时新增空练习记录。

## 步骤

- [x] 导出清理前完整记录快照到 `exports/records-snapshot-before-cleanup-20260819.json`。
- [x] 定位 4 条疑似临时记录：3 条 `p1-low-116`、1 条 `p1-high-200`，均为 2026-08-19 15:49-15:52、用时 1 秒、0/13。
- [x] 通过 SQLite 后端删除这 4 条记录，并确认后端不再包含这些 ID。
- [x] 收紧 `saveStandalonePracticeCompletion()`：回顾模式、套题回放模式、套题提交投影不能触发单篇完成保存兜底。
- [x] 修复 Playwright 验证脚本，在页面初始化阶段 stub 记录 API，并拦截 SQLite 写接口，避免测试写真实后端。
- [x] 增加单元回归：`reviewMode` 下调用提交函数不得创建 standalone completion。
- [x] 重建 bundle，跑单元测试和浏览器测试，并确认测试后真实后端没有新增疑似 0 秒记录。

# 2026-08-19 错因控件高亮污染修复计划

## 目标

修复复盘页错因控件中出现棕红色高亮块的问题，让阅读高亮恢复绑定文字和上下文，而不是被动态插入的错因控件扰动位置。

## 步骤

- [x] 定位棕红色块来源为 `.hl` 高亮恢复，不是错因控件样式。
- [x] 修复高亮文本流，排除错因控件、内联错因行和解析卡。
- [x] 修复恢复策略：`start/end` 位置必须通过文字和 `before/after` 上下文校验，不匹配时按文字上下文重找。
- [x] 补充 Playwright 回归，覆盖错因控件不生成 `.hl`、同文本多处时按上下文恢复。
- [x] 重建 bundle，运行浏览器验证，并确认真实后端没有新增测试记录。

# 2026-08-05 套题选项全文判题修复计划

## 目标

修复拖拽选项题保存 `字母 + 选项全文` 时被误判的问题，例如用户答案 `B MBA graduates` 应该匹配标准答案 `B`。

## 步骤

- [x] 查询最新套题 SQLite 记录，确认当前保存分数为 `21/40`。
- [x] 对照三篇题库 `answerKey`，确认标准答案本身没有错。
- [x] 定位误判题为 `p3-medium-152` Q37-Q40，原因是选项全文被拆成多个 token。
- [x] 修复公共判题核心 `AnswerMatchCore.compareAnswers()`。
- [x] 同步统一阅读页兜底判题逻辑。
- [x] 增加回归测试覆盖 `B MBA graduates -> B`，并防止 `A C`、`a panoramic camera` 误判。
- [x] 修复最新套题 SQLite 记录分数：`21/40` -> `25/40`。
- [x] 提升缓存版本并重建 bundle。

# 2026-08-06 套题刷新旧分数修复计划

## 目标

修复最新套题刷新后仍显示旧 `53%`、错因数仍按旧误判显示 `0/19` 的问题，保证历史卡片、摘要接口、详情/导出使用同一套批改结果。

## 步骤

- [x] 验证 SQLite 和 8081 API 主记录当前批改明细为 `25/40`。
- [x] 定位残留旧字段：顶层 `correctAnswers=21` 导致前端重新算成 `53%`。
- [x] 修复真实 SQLite 记录，使 `score/correctAnswers/scoreInfo/percentage` 一致。
- [x] 调整前端和后端摘要优先级，优先使用 `scoreInfo.correct/score`。
- [x] 修复错因统计去重逻辑，防止旧影子明细覆盖已判正确题目。
- [x] 提升缓存版本到 `20260806-suite-score-sync` 并重建 bundle。
- [x] 用浏览器验证练习历史卡片显示 `错因 0/15`、`63%`。

# 2026-08-07 套题回放二次误判修复计划

## 目标

修复最新套题详情/回放刷新后，把保存时已经判对的题组多选题重新算成错误的问题。交卷判题逻辑不改，数据库已有判题结果作为回放展示的事实来源。

## 步骤

- [x] 读取 SQLite 最新记录 `suite_msin6wot_d547e0`，确认真实保存结果为 `24/40`。
- [x] 对照题组定义，确认 `p1-high-118` Q11-Q13、`p2-high-09` Q1-Q8 是成组多选。
- [x] 定位回放入口 `buildReplayResults()`：它只保留 `answerDetails/scoreInfo.details` 的 `isCorrect`，对 `answerComparison` 的保存判题重新调用普通 `compareAnswers()`。
- [x] 修复回放逻辑：只要记录项已有布尔型 `isCorrect`，就直接使用保存结果，不再二次改判。
- [x] 增加回归测试覆盖题组多选回放不能被重算成错。
- [x] 提升缓存版本到 `20260807-replay-judgement` 并重建 bundle。
- [x] 用浏览器验证最新套题详情仍显示 `24/40`、`60%`，多选题行保持正确。

# 2026-08-09 错因分类新增计划

## 目标

只追加两个新的错因分类：`思路错误`、`单词不认识`。不重命名、不删除、不迁移原有错因分类。

## 步骤

- [x] 定位错因下拉选项来源 `js/runtime/unifiedReadingPage.js::WRONG_REASON_OPTIONS`。
- [x] 确认 SQLite 保存层没有固定分类枚举，新分类会作为 `wrongReasons[*].category` 字符串保存。
- [x] 追加 `思路错误`、`单词不认识` 两个选项。
- [x] 提升缓存版本到 `20260809-wrongreason-options`。
- [x] 重建页面实际加载的 bundle。

# 2026-08-09 原远程阅读题库内容同步计划

## 目标

从原仓库 `sallowayma-git/IELTS-practice.git` 的 `origin/opensource` 只同步阅读文章/题目数据 JS，不采纳远程逻辑代码。

## 步骤

- [x] `git fetch origin --prune`，确认远程 `origin/opensource` 更新到 `b4ee0d9`。
- [x] 对比远程阅读题库数据文件，筛出 `assets/generated/reading-exams` 范围内的文章/题目内容变化。
- [x] 同步 17 个已有文章数据 JS 的远程内容修正。
- [x] 补入 2 个当前本地缺失的文章数据 JS：`p2-medium-243.js`、`p3-medium-244.js`。
- [x] 合并 manifest 的新增文章入口和 PDF/HTML 可用性字段；不覆盖本地已有频率标签和中文标题。
- [x] 运行题库数据 JS 语法检查和 manifest 脚本完整性检查。

# 2026-08-10 澳洲野狗逐题解析错位修复计划

## 目标

修复 `p2-low-051`（The dingo debate 澳洲野犬_澳洲野狗）题目下方答案/题目翻译/解析错位的问题，只改解析数据，不改页面逻辑。

## 步骤

- [x] 定位当前入口文章为 `assets/generated/reading-exams/p2-low-051.js`。
- [x] 确认 `assets/generated/reading-explanations/p2-low-051.js` 只有段落翻译，`questionExplanations` 为空。
- [x] 找到同篇旧编号 `p2-low-140` 的完整逐题解析，确认题号 14-26 与 `q1-q13` 映射一致。
- [x] 将 `p2-low-140` 的 13 条逐题解析同步到 `p2-low-051`。
- [x] 运行解析文件语法检查和题号映射一致性检查。
- [x] 根据截图继续定位段落翻译错位：`.paragraph-label` 标签独立于多个自然段，旧逻辑按 `<p>` 顺序插入翻译。
- [x] 修复段落翻译锚点：优先按 `.paragraph-label` 找到同一字母段的最后一个自然段，再插入该段翻译。
- [x] 给动态加载的题库/解析数据脚本追加版本号，避免浏览器继续使用旧解析 JS。
- [x] 提升缓存版本到 `20260810-dingo-passage-notes` 并重建 bundle。

# 2026-08-10 段落翻译整体错位修复计划

## 目标

修复多篇阅读文章段落翻译经常错位的问题。页面插入段落翻译时不能再简单按 `<p>` 顺序对应 `passageNotes`，而要优先使用解析标签和原文标签建立稳定锚点。

## 步骤

- [x] 对比 `origin/opensource` 的 `js/runtime/unifiedReadingPage.js`，确认原远程也使用旧 `<p>` 顺序插入逻辑，不是单纯由本地新功能引入。
- [x] 梳理题库结构差异：独立 `.paragraph-label`、段首 `<strong>A</strong>`、数字段落、斜体引言、同一字母段包含多个自然段。
- [x] 将 `resolvePassageTargets()` 改为接收 `passageNotes`，按解析 label 选择插入锚点。
- [x] 字母段落优先匹配独立 `.paragraph-label`，翻译插入到该字母段最后一个自然段后。
- [x] 兼容段首 `<strong>A</strong>` / `<b>A</b>` 的文章。
- [x] 数字段落按 `Paragraph 1/2/3` 映射，自动跳过题目说明和纯斜体引言。
- [x] 保留旧顺序插入作为最后兜底。
- [x] 增加回归测试，覆盖“引言 + A 段多自然段 + B 段”和“数字段落跳过斜体引言”。
- [x] 缓存版本提升到 `20260810-passage-note-targets` 并重建 bundle。

# 2026-08-11 错因多选与直接打开保存计划

## 目标

错因保存支持同一道题选择多个错因；直接用统一阅读页 URL 打开文章并提交时，也必须写入练习记录，避免后续错因保存找不到目标记录。

## 步骤

- [x] 确认 `p3-high-181` 果实之书题目和解析资源存在且可解析。
- [x] 确认 SQLite 服务可用，但数据库中没有 `p3-high-181` 完成记录。
- [x] 定位原因：直接打开做题页时 `PRACTICE_COMPLETE` 没有父页面接收，完成记录没有入库。
- [x] 将错因结构扩展为 `categories: []`，同时保留旧字段 `category`。
- [x] 同步阅读页、主页保存校验、本地 SQLite 服务错因校验。
- [x] 增加直接打开提交保存兜底：父页面消息未送达时，阅读页直接调用 `PracticeRecordAPI.saveCompletion()`。
- [x] 提升资源版本并重建 bundle。
- [x] 增加并运行回归测试。

# 2026-08-12 PDF 401、错因控件样式、套题频率筛选计划

## 目标

解释 `Scented Plants 植物的味道` PDF 401 的来源；修复错因复选框被错题答案高亮污染；修复“仅高频”套题选择低频文章的问题。

## 步骤

- [x] 定位 `Scented Plants 植物的味道` 为 `p1-low-67`，manifest 标记频率为 `low`。
- [x] 确认本地仓库没有 `ReadingPractice/PDF/159. P1 - Scented Plants 植物的味道.pdf` 文件，PDF 按钮依赖旧外部/缺失资源路径。
- [x] 隔离错因控件：`reading-answer-wrong-choice` / `reading-answer-error-focus` 只作用于真实作答控件。
- [x] 自选套题列表按 `frequencyScope` 过滤；点击选择时再次校验，禁止低频进入“仅高频”套题。
- [x] 状态层 `selectCustomSuiteExam()` 增加频率校验，防止绕过 UI 写入错误选择。
- [x] 自选套题启动前按频率范围检查每个 P1/P2/P3 是否有可选题。
- [x] 提升缓存版本到 `20260812-suite-frequency-ui-fix`。
- [x] 重建 bundle 并运行回归测试。
- [x] 复查用户更正后的自动随机套题链路：自动套题已有频率过滤，但旧规则会把频率缺失/未知的文章放进“仅高频”候选池。
- [x] 将自动套题、自选列表、点击选择、状态写入统一改为：在“仅高频 / 高频+次高频”受限范围内，频率缺失或无法识别的文章不允许进入候选。
- [x] 对比原远程 `origin/opensource`：远程仓库没有 PDF 文件、PDF 目录或 PDF 压缩包；当前不能通过 Git 拉取 PDF。
- [x] 对比原远程 `manifest.js` 频率标签，确认共有 13 篇与本地不同；`p1-low-67 Scented Plants 植物的味道` 远程和本地均为 `low`。
- [x] 提升缓存版本到 `20260812-suite-frequency-strict`。

# 2026-08-15 表格题错因控件错位修复计划

## 目标

修复 `p2-low-50` 段落匹配表格题中，错因控件插入后打散 `<table>` 行列，导致 Q15-Q17 选项错位的问题。

## 步骤

- [x] 确认 `p2-low-50` 的 Q14-Q17 是 `.matching-table` 表格题，不是文章数据缺题。
- [x] 定位通用阅读页把逐题解析/错因控件追加到 `<tr>` 的风险；浏览器会修正非法 DOM，造成表格列错位。
- [x] 新增表格整行插入 helper：表格题的逐题解析、答案卡、错因控件都使用新的 `<tr><td colspan="...">` 容器。
- [x] 保留普通题型原有块状插入逻辑。
- [x] 增加表格错因控件回归测试。
- [x] 提升缓存版本到 `20260815-table-inline-review` 并重建 bundle。
- [x] 用 Playwright 驱动本机 Edge 验证 `p2-low-50` 新版页面：错因控件位于整行表格行，Q15 仍保持正常表格行。

# 2026-08-20 洪水防控错因保存与摘要字段修复计划

## 目标

修复最新记录 `Keeping the water away 洪水防控` 看起来保存不了错因、练习历史显示 0% 的问题。错因必须继续增量更新同一条完成记录，不新增 0% 空记录，不重算或篡改答案明细。

## 步骤

- [x] 定位文章 ID：`p2-low-37`。
- [x] 读取 SQLite 最新记录，确认记录存在且 Q2、Q3 错因已经写入。
- [x] 确认异常点：记录外层 `accuracy/score/totalQuestions` 为 `11/13`，但 `percentage` 和轻量 `scoreInfo` 为 0/空，导致列表和回显读到不一致字段。
- [x] 修复 `PracticeCore.standardizeRecord()`：保存/标准化记录时补齐 `scoreInfo.correct/total/accuracy/percentage`，并保留多选错因 `categories`。
- [x] 修复 `PracticeRecordAPI` 轻量摘要：遇到 `percentage=0` 但 `score/total/accuracy` 有真实值时，按真实分数投影。
- [x] 修复 SQLite 后端摘要和错因增量保存：后端返回摘要时按真实分数兜底，保存错因时顺手补齐同一条记录的分数字段。
- [x] 增加回归测试并重建 bundle。
- [x] 缓存版本提升到 `20260820-wrongreason-score-summary`。
- [x] 用临时 8098 服务读取真实 SQLite，确认 `p2-low-37` 返回 `85% / 11/13` 且 Q2、Q3 错因存在。

# 2026-08-20 巨兽灭绝选项排版修复计划

## 目标

修复 `Australia’s Megafauna Controversy 巨兽灭绝` Q36-Q40 选择题选项挤在同一行的问题；只调整统一阅读页通用样式，不修改题目内容、答案和判题逻辑。

## 步骤

- [x] 定位文章 ID：`p3-medium-197`，题目数据文件为 `assets/generated/reading-exams/p3-medium-197.js`。
- [x] 确认 Q36-Q40 使用旧结构 `.options > label`，而统一页样式只覆盖 `.radio-group`、`.options-list` 等新结构。
- [x] 在 `reading-practice-unified.html` 中将 `.options label` 纳入块状选项布局，将 `.options label input[type="radio"]` 纳入单选按钮对齐规则。
- [x] 增加回归测试，防止旧 `.options` 结构再次漏掉通用布局。
- [x] 缓存版本提升到 `20260820-megafauna-options-layout` 并重建 bundle。
- [x] 用 8081 + Edge/Playwright 验证 Q36 四个选项逐行显示。

# 2026-08-22 湖泊海啸研究错因控件错位修复计划

## 目标

修复最新套题中 `Effect and Cause 湖泊海啸研究` 的错因控件错位；从通用插入锚点层面修复，避免判断题、flow-chart 填空题继续把控件插到 input、label 或整个题组后面。

## 步骤

- [x] 从 SQLite 最新记录定位到套题 `suite_mt3wnjc9_ae925a`，其中 P1 为 `p1-low-223 Effect and Cause 湖泊海啸研究`。
- [x] 确认本篇错题为 Q1、Q4、Q7、Q10；Q1/Q4/Q7 是 `.question-block` 判断题，Q10 是 `.flowchart-item` 填空题。
- [x] 定位根因：`findInlineWrongReasonHost()` 和 `findQuestionAnchor()` 的题目宿主选择器没有覆盖 `.question-block` / `.flowchart-item`，导致控件插到 input 或整个 `.unified-group` 附近。
- [x] 新增 `QUESTION_HOST_SELECTOR` 和 `getQuestionHostFromNode()`，统一题目容器定位。
- [x] 增加回归测试覆盖 `.question-block` 和 `.flowchart-item`。
- [x] 缓存版本提升到 `20260822-wrongreason-question-host` 并重建 bundle。
- [x] 用 8081 + Edge/Playwright 验证 `p1-low-223` Q1/Q4/Q7/Q10 控件都插在各自题目块后。

# 2026-08-25 最新三套复盘错位与详细解析补全计划

## 目标

修复最近三套题在复盘页出现的段落翻译错位、错因控件错位，以及“没答案/没详细解析”的问题。这里的“没答案”按用户澄清理解为缺少逐题详细解析，不是 `answerKey` 缺失。

## 步骤

- [x] 从 SQLite 最新记录定位最近三套共 9 篇文章。
- [x] 检查 9 篇文章的 `answerKey` 与 `questionExplanations`，确认缺详细解析的是 `p2-high-232` 和 `p3-medium-169`。
- [x] 检查对应 PDF：`p2-high-232` PDF 文本提取不可用，`p3-medium-169` PDF 只有原文；详细解析按当前题库原文和标准答案补齐。
- [x] 补齐 `p2-high-232 The origin and development of applause 掌声的历史` 的 13 条逐题解析。
- [x] 补齐 `p3-medium-169 Music Language We All Speak 音乐语言` 的 14 条逐题解析。
- [x] 修复 `.paragraph-wrapper` / `Section A:` 结构的段落翻译锚点，翻译插入到该 section 最后一个有效正文段后。
- [x] 修复图表填空 `.diagram-input-item` 的错因控件宿主定位。
- [x] 修复同一段落内多道错题共用宿主时，错因控件反复插到前一个控件前方导致顺序颠倒的问题。
- [x] 增加回归测试覆盖以上三种 DOM 结构。
- [x] 缓存版本提升到 `20260825-latest-suite-review-fix` 并重建 bundle。
- [x] 用 8081 + Playwright + Edge 验证最近三套 9 篇文章的错因控件插入结构。
