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
- 本地存储可能包括 IndexedDB、localStorage、外部 JSON 备份，修复时必须确认页面实际读取的是哪一层。
- ID 补全只能增量写入现有练习记录里的 `examId/dataKey/derivedExamId`、`metadata.*`、`realData.*`，不能因为补 ID 重建记录、覆盖时间、改 `duration` 或产生重复记录。
- 启用 `scripts/local_backup_server.py` 后，练习记录优先写入同源 SQLite 后端；只有后端不可用时才回退浏览器存储。SQLite 数据库为空且浏览器已有旧记录时，只允许一次性导入旧记录到 SQLite，不能用空库覆盖浏览器记录。
- 启动本地练习服务时优先使用 `scripts/local_backup_server.py`，不要退回普通 `python -m http.server`。该服务会把 `E:\hnu\雅思\备份zyz\practice-backup-latest.json` 暴露给同源页面，用于启动自动加载/合并最新 JSON 备份。
- `scripts/local_backup_server.py` 默认数据库文件是 `E:\hnu\雅思\备份zyz\ielts-atlas.sqlite`。启动时如果数据库为空且 `practice-backup-latest.json` 有记录，会自动导入最新 JSON 备份到 SQLite；数据库已有记录时不自动覆盖。
- 自动加载本地 JSON 备份时，浏览器记录为空才完整恢复；浏览器已有记录时只能合并，不允许用备份直接覆盖并删除本地已有记录。
- 备份中的 `user_stats` 可能是空对象或全 0；恢复时不能让空统计覆盖可从 `practice_records` 重算出的统计。
- 做题页加载 `core-foundation.bundle.js` 只是为了记录 API 等核心能力，不能初始化主页/设置页专属 UI，例如本地磁盘备份弹窗。
- “连续学习天数 / 坚持天数”的业务口径不能凭字段名改；修改前必须先对照原分支、当前记录日期、热力图“活跃天数”和用户期望。

## 验证清单

- 完成后运行语法检查和打包。
- 至少做自动化链路测试：输入错因、保存、读回、刷新/重新打开后仍能显示。
- 保存失败测试必须确认按钮不会显示“已保存”，并且 beforeunload 会拦截。
- 后端测试必须使用临时 SQLite 和临时备份目录，不得写入 `E:\hnu\雅思\备份zyz` 的真实文件。
- 修改缓存版本号，避免浏览器继续加载旧 bundle。
- 服务启动后确认当前 URL 返回 200，并且页面使用新版本号。
