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
