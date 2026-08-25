# 维护注意事项

## 练习记录和错因保存

- 修改错因或备份功能前，必须先读 `定位.md` 对应板块，并确认当前发送、接收、保存、读回校验位置；改完必须同步更新 `定位.md`。
- 错因保存相关日志统一用 `[WrongReasonSave]` 前缀，备份相关日志统一用 `[ExternalBackup]` 前缀；新增保存分支必须有可定位的成功、失败、读回校验日志。
- 不允许只做 UI 状态。按钮显示“已保存”之前，必须确认数据已经写入练习记录，并且能从同一条记录中读回对应错因。
- 错因保存要覆盖三种入口：主页打开的单篇、套题中的篇章、从练习历史回放打开的页面。
- 每篇文章必须使用统一、稳定的文章 ID 匹配：优先 `examId/dataKey/derivedExamId`，标准阅读 session 可从 `p1-medium-63_...` 这类前缀推导出 `p1-medium-63`。只能接受 `p/c + part + low/medium/high + 编号` 的标准前缀，不能把任意 session 字符串当文章 ID。
- 套题和单篇可能使用同一篇文章 ID，保存时必须用 session / suiteSession / recordId 区分，不能只按 examId 覆盖最新记录。
- 回顾页或新窗口里的 `sessionId` 可能和最初完成记录不同；这种情况只能回退到“同一 examId/dataKey 且包含本次错题题号”的已有记录，不能按同篇最新记录盲写，也不能新建记录。
- 标题只能作为排查或低优先级辅助信息，不能在同篇候选不唯一、题号不匹配时单独决定写入哪条记录。
- 如果父窗口保存失败，不能吞掉错误后返回成功。必须继续走当前页 API 或本地兜底，全部失败时返回失败。
- 启用 SQLite 后，错因保存要优先走 `/api/sqlite/practice-records/wrong-reasons` 专用增量接口；该接口必须只更新已有记录、后端读回校验成功后才返回成功。不要优先依赖父窗口内存状态，否则新开做题页/回顾页可能和主页记录状态不同步。
- `saveRecord` 的返回值可能是精简对象或投影对象，不能只用返回值判断错因是否保存成功；必须通过 `getById/list` 或同一存储层重新读回原记录确认。
- 用户输入了错因但没有确认保存成功时，页面关闭或刷新前必须至少提示一次，避免“看起来保存了、实际没保存”。
- 自动保存不能清空待保存状态，除非已经确认写入成功。
- 导出、历史复盘、详细页展示都必须从同一份记录结构读取错因，不能各自拼一套字段。
- 错因保存是练习记录的增量更新，只能更新已有 recordId/sessionId 对应的原记录；找不到原记录时不能为了保存错因新建一条练习记录。
- 错因保存不能改 `startTime`、`endTime`、`date`、`duration`、`createdAt`、`updatedAt`。错因本身的更新时间只能放在 `wrongReason.updatedAt` 或 `metadata.wrongReasonUpdatedAt`。

## 练习用时和日期

- 一篇文章的用时只计算从开始做题到点击提交的时间；提交后看解析、填写错因、停留页面的时间不能进入 `duration`。
- 提交消息里的 `endTime/date` 应使用提交瞬间的有效完成时间：优先 `effectiveEndTime/effectiveEndTimeMs`，否则用 `startTime + duration`。真实消息发送时间如需保留，只能另存调试字段，不能覆盖练习完成时间。
- 统计和热力图按日期聚合时必须统一使用本地日期（`getFullYear/getMonth/getDate`），不能一边用 UTC `toISOString().slice(0,10)`，一边用本地日期，否则晚上做题会被算到前一天并打断连续天数。

## 数据安全

- 修改练习记录链路前，先确认 JSON 备份是否足以完整恢复记录；CSV/Markdown 只能作为导出，不应作为完整备份依据。
- 不要清空、重建或迁移用户记录，除非已经确认目标数据属于本应用并且有可恢复备份。
- 测试数据必须使用明显的临时 ID，测试结束后删除，不能混进用户真实练习记录。
- 浏览器自动化测试如果访问真实 8081 服务，必须在页面初始化前 stub `PracticeRecordAPI`，并拦截 `/api/sqlite/practice-records` 写请求；不能让 Playwright/Edge 测试把 0 秒记录写入真实 SQLite。
- 本地存储可能包括 IndexedDB、localStorage、外部 JSON 备份，修复时必须确认页面实际读取的是哪一层。
- ID 补全只能增量写入现有练习记录里的 `examId/dataKey/derivedExamId`、`metadata.*`、`realData.*`，不能因为补 ID 重建记录、覆盖时间、改 `duration` 或产生重复记录。
- 启用 `scripts/local_backup_server.py` 后，练习记录优先写入同源 SQLite 后端；只有后端不可用时才回退浏览器存储。SQLite 数据库为空且浏览器已有旧记录时，只允许一次性导入旧记录到 SQLite，不能用空库覆盖浏览器记录。
- 启动本地练习服务时优先使用 `scripts/local_backup_server.py`，不要退回普通 `python -m http.server`。该服务会把 `E:\hnu\雅思\备份zyz\practice-backup-latest.json` 暴露给同源页面，用于启动自动加载/合并最新 JSON 备份。
- `scripts/local_backup_server.py` 默认数据库文件是 `E:\hnu\雅思\备份zyz\ielts-atlas.sqlite`。启动时如果数据库为空且 `practice-backup-latest.json` 有记录，会自动导入最新 JSON 备份到 SQLite；数据库已有记录时不自动覆盖。
- 自动加载本地 JSON 备份时，浏览器记录为空才完整恢复；浏览器已有记录时只能合并，不允许用备份直接覆盖并删除本地已有记录。
- 备份中的 `user_stats` 可能是空对象或全 0；恢复时不能让空统计覆盖可从 `practice_records` 重算出的统计。
- 做题页加载 `core-foundation.bundle.js` 只是为了记录 API 等核心能力，不能初始化主页/设置页专属 UI，例如本地磁盘备份弹窗。
- “连续学习天数 / 坚持天数”的业务口径不能凭字段名改；修改前必须先对照原分支、当前记录日期、热力图“活跃天数”和用户期望。

## 词表与复习进度

- 词表进度字段必须和 `js/core/vocabScheduler.js` 的 SM-2 逻辑一致，只能展示真实保存字段：`correctCount`、`repetitions`、`interval`、`easeFactor`、`intraCycles`、`lastReviewed`、`nextReview` 和设置里的 `masteryCount`。
- 不要新增“轮次/掌握度/状态”等脱离算法的独立进度字段。状态只能由已有字段推导：未学习、待复习、学习中、已掌握。
- 词表持久化以 `VocabStore` 为统一入口；页面组件不能直接绕过它改 SQLite 或 localStorage。
- SQLite 后端可用时，词表快照写入 `meta/vocab_state`；后端不可用时必须保留原浏览器存储路径，不能影响正常背词。
- 备份恢复词表时要同时恢复当前词表 ID、各词表词条、复习队列和用户设置；不能只恢复单词文本。
- 词表 UI 的上次/下次复习只需要日期粒度；除非排查算法问题，不要在主表展示时分秒。

## 阅读页高亮

- 普通高亮使用 `.hl`，二次高亮使用 `.hl[data-hl-level="secondary"]`；不要用内联 `style` 临时改色，否则刷新和回放无法恢复。
- 高亮持久化必须经过 `readingHighlightShared.js` 的 `snapshotHighlights()` / `restoreHighlights()`，新增视觉状态时要同步保存字段并保持旧快照兼容。
- 笔记高亮使用 `data-hl-type="note"`，不要和二次高亮混成同一个字段；两者职责不同。
- 二次高亮必须包住当前新选区，不能直接把已有 `.hl` 整体升级成 secondary。否则用户只选一个单词时，整句或整段都会变玫红。
- 高亮恢复必须按“文字 + 上下文”校验，不能只按 `start/end` 位置落点。复盘页会动态插入解析和错因控件，单纯位置偏移会把高亮染到控件里。
- 高亮文本流必须排除错因控件和解析卡；`.wrong-reason-controls` 里不能出现由恢复逻辑生成的 `.hl`。

## 判题规则

- 拖拽选项题可能保存 `字母 + 选项全文`，例如 `B MBA graduates`。当标准答案是单个大写字母时，应按开头选项标签判断。
- 不要把所有以字母开头的短语都折叠为选项标签；`a panoramic camera` 这类填空短语必须保留原文本。
- `A C`、`A, C` 等多选答案不能因为第一个字母是 A 就被折叠成单选 A。
- 改判题核心时必须同步 `js/utils/answerMatchCore.js` 和 `js/runtime/unifiedReadingPage.js` 的兜底逻辑，并补 `developer/tests/js/answerMatchCoreRegression.test.js`。
- 练习记录里可能同时存在 `scoreInfo.correct/score`、`score`、`correctAnswers` 多套分数字段。历史列表、摘要接口、统计和导出应优先使用 `scoreInfo.correct/score` 与 `score`，`correctAnswers` 只能兜底，避免旧字段把已修正分数重新算回旧值。
- 错因统计遍历多个明细来源时，遇到同一题的明确正确结果也必须加入 `seen`。不能只在错误时去重，否则后面的旧 `realData/scoreInfo` 影子明细会把已经修正为正确的题再次统计为错题。
- 回放/详情页不能随意二次改判。只要练习记录已有明确 `isCorrect: true/false`，必须优先展示这个保存结果；只有缺少保存判题时才允许用答案表兜底计算。

## 错因分类

- 错因分类是保存在 `wrongReasons[*].category` 里的字符串，不是独立枚举表；新增分类只能追加，不能重命名旧分类。
- 前端选项来源是 `js/runtime/unifiedReadingPage.js::WRONG_REASON_OPTIONS`。新增后必须重建 `reading-page.bundle.js` 并提升缓存版本。
- 多选错因必须同时保存 `categories` 数组和兼容旧字段 `category`。`category` 只能放第一个分类，完整展示/校验应优先使用 `categories`。
- 阅读页、主页保存校验、SQLite 后端 `normalize_wrong_reason()` 必须同时理解 `category` 和 `categories`；只改 UI 会导致保存后读回校验失败。
- `PracticeCore`、`PracticeRecordAPI` 和 SQLite 后端的错因标准化都必须保留 `categories`。任一路径把错因压成单个 `category`，多选保存后就会出现数据库有数据但前端校验/回显像失败。
- 直接 URL 打开统一阅读页时，父页面可能不存在。非套题单篇提交必须在 `postMessage('PRACTICE_COMPLETE')` 未送达时走当前页 `PracticeRecordAPI.saveCompletion()` 兜底，否则数据库没有完成记录，之后错因保存必然找不到目标。
- `saveStandalonePracticeCompletion()` 只能服务真实单篇提交，必须排除 `reviewMode`、`suiteReviewMode`、`suite.inline`、`simulationMode` 和 `payload.suiteSubmission`。复盘页或套题错题回顾不能新建练习记录。
- 错因控件是复盘标注控件，不是作答控件。任何错题答案高亮逻辑都必须跳过 `.wrong-reason-controls`、`.wrong-reason-category-checkbox`、`.wrong-reason-note`，否则会把错因区域染成红框或异常色块。
- 表格题中的错因控件、逐题解析、背题答案卡不能作为普通 `<div>` 直接追加到 `<tr>`。必须插入新的整行 `<tr><td colspan="...">...</td></tr>`，否则浏览器会重排表格并造成题目/选项错位。
- 非表格题的错因控件也不能插到 input、label 或整个题组后面。新增题型结构时必须先把题目整体容器加入 `QUESTION_HOST_SELECTOR`，例如 `.question-block`、`.flowchart-item`。
- 错因备注框要拦截自身键盘事件继续冒泡；页面级空格快捷键不能影响 `.wrong-reason-note` 的正常输入。

## 套题频率筛选

- “仅高频”只能包含 `高频/high/超高频/ultra-high`；“高频+次高频”只能包含高频、超高频、次高频、中频。
- 未做题不足时，只能在同一频率范围内放宽为已做题，不能从高频兜底到低频。
- 自选套题必须同时在列表、点击选择、状态写入三层校验频率范围。
- 频率为空或无法识别时，只能进入“全部频率”或自定义手动流程；不能进入“仅高频 / 高频+次高频”的自动候选池或自选写入层。

## PDF 资源

- manifest 的 `pdfFilename` 不等于仓库里一定存在 PDF 实体文件。当前本地仓库没有 `ReadingPractice/PDF` 目录。
- PDF 打开出现 401/404 时，先确认本地或远程 PDF 资源是否真实可访问；不要把 PDF 权限问题和 HTML 做题页、练习记录保存问题混在一起处理。
- 原远程 `origin/opensource` 目前也没有 PDF 实体文件、PDF 目录、PDF 压缩包或 LFS PDF 清单；不能假设 `git pull` 会补齐 PDF。

## 远程题库内容同步

- 从原仓库同步题库内容时，只取 `assets/generated/reading-exams` / `assets/generated/reading-explanations` 的数据资源；不要合并远程运行逻辑、页面逻辑或构建产物。
- `assets/generated/reading-exams/manifest.js` 不能整文件覆盖当前本地版本；应字段级合并新增入口和资源可用性，保留本地已有标签、难度和标题调整。
- 老题库结构 `.options > label` 也是合法选择题结构。遇到选项排版问题时优先修统一阅读页通用样式，不要逐篇改生成题目数据。
- 段落翻译不能简单按 `<p>` 顺序对应 `passageNotes`。遇到 `.paragraph-label` / A-H 段落标签时，应以标签段为单位定位到该字母段最后一个内容元素，否则一个字母段包含多个自然段时会翻译错位。
- 动态加载的题库 JS、解析 JS、manifest JS 必须带资源版本号，避免浏览器缓存旧数据文件。
- 段落翻译锚点优先级：解析 label -> 原文独立 `.paragraph-label` -> 段首 `<strong>/<b>` 字母标签 -> 数字段落正文序号 -> 旧顺序兜底。不要再新增只按第几个 `<p>` 插入的逻辑。
- 如果解析 label 看起来是结构化段落标签，但原文找不到一一对应锚点，必须退到整组“原文翻译”展示，不能继续顺序硬插。
- 无标签 `passageNotes` 的数量和可用自然段落数量不一致时，也必须退到整组展示；宁可集中显示，也不能贴到错误段落后。
- 用户说“没答案”时要先区分 `answerKey` 缺失和 `questionExplanations` 缺失。复盘页没有详细讲解通常是后者，不代表标准答案不存在。
- `.paragraph-wrapper` 包住多个自然段时，`Paragraph A` / `Section A` 翻译必须落到这个 wrapper 的最后一个有效正文元素后；不要只取 wrapper 里的第一个 `<p>`。
- `Section A`、`Paragraph A`、`A` 在段落翻译锚点里应归一为同一个字母 key。
- 题型新增或题库结构变化时，先检查真实单题容器是否在 `QUESTION_HOST_SELECTOR`，例如 `.diagram-input-item`、`.question-block`、`.flowchart-item`。
- 多个错题共享同一段落宿主时，错因控件要按题号追加在已有错因控件后方，不能每次都插在宿主后面导致后插的控件跑到前面。

## 阅读页性能

- `reading-page.bundle.js` 只放做题页首屏必要逻辑。5MB 级词典、完整导出数据、批量资源扫描等重资源不能同步打进阅读页 bundle。
- 回顾页高亮查词所需的 `assets/wordlists/ecdict_reading.bundle.js` 应按需加载；改 `DictionaryService` 时要确认后加载词典能触发索引重建。

## 练习记录摘要

- 不要只用 `record.percentage` 判断历史记录正确率。旧记录可能存在 `percentage=0`，但 `score/totalQuestions/accuracy` 已经是正确值。
- 轻量摘要、历史列表和后端 `/api/sqlite/practice-records/summary` 应按 `scoreInfo -> 顶层 score/total/accuracy -> percentage` 的真实分数口径兜底。
- 排查“错因保存不了”时，先读 `/api/sqlite/practice-records` 真实记录，确认 `wrongReasons` 是否已写入；按钮未变或列表显示 0% 可能是字段投影问题，不一定是保存链路失败。

## 验证清单

- 完成后运行语法检查和打包。
- 至少做自动化链路测试：输入错因、保存、读回、刷新/重新打开后仍能显示。
- 保存失败测试必须确认按钮不会显示“已保存”，并且 beforeunload 会拦截。
- 后端测试必须使用临时 SQLite 和临时备份目录，不得写入 `E:\hnu\雅思\备份zyz` 的真实文件。
- 修改缓存版本号，避免浏览器继续加载旧 bundle。
- 服务启动后确认当前 URL 返回 200，并且页面使用新版本号。
