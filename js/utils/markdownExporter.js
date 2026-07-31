/**
 * Markdown 导出器
 * 用于将练习数据导出为 Markdown 格式
 */
class MarkdownExporter {
    normalizeTitle(rawTitle) {
        if (!rawTitle) return '未知题目';
        const title = String(rawTitle).trim();
        if (!title) return '未知题目';

        // 兼容类似 "IELTS Listening Practice - Part 4 Leatherback Turtles" 的标题
        const practiceMatch = title.match(/ielts\s+listening\s+practice\s*-\s*part\s*\d+\s*[:\-]?\s*(.+)$/i);
        if (practiceMatch && practiceMatch[1]) {
            return practiceMatch[1].trim();
        }

        // 通用的 “A - B” 结构，优先取末尾部分
        if (title.includes(' - ')) {
            const segments = title.split(' - ').map(s => s.trim()).filter(Boolean);
            if (segments.length > 1) {
                return segments[segments.length - 1];
            }
        }

        return title;
    }

    hasAnswerDetails(record) {
        if (!record) return false;
        const comparison = record.answerComparison || record.realData?.answerComparison;
        const answers = record.answers || record.realData?.answers;
        const details = record.scoreInfo?.details || record.realData?.scoreInfo?.details || record.answerDetails;
        return (comparison && Object.keys(comparison).length > 0)
            || (answers && Object.keys(answers).length > 0)
            || (details && Object.keys(details).length > 0);
    }

    isAnswerMap(value) {
        return Object.prototype.toString.call(value) === '[object Object]';
    }

    // 合并 comparison 与其他来源以补全缺失 correctAnswer
    mergeComparisonWithCorrections(record) {
        const comparison = JSON.parse(JSON.stringify(record.answerComparison || {}));
        const sources = [this.getCorrectAnswers(record)].filter(source => this.isAnswerMap(source));
        const getFromSources = (key) => {
            for (const src of sources) {
                if (src && src[key] != null && String(src[key]).trim() !== '') return src[key];
            }
            return null;
        };
        Object.keys(comparison).forEach(key => {
            const item = comparison[key] || {};
            if (item.correctAnswer == null || String(item.correctAnswer).trim() === '') {
                const fixed = getFromSources(key);
                if (fixed != null) item.correctAnswer = fixed;
            }
            if (item.userAnswer == null) item.userAnswer = '';
            if (item.correctAnswer == null) item.correctAnswer = '';
            comparison[key] = item;
        });
        // 映射 qa.. 到可能对应的数值区间 q14..q20
        const letterKeys = Object.keys(comparison).filter(k => /^q[a-z]$/i.test(k));
        if (letterKeys.length > 0) {
            let numericKeys = Object.keys(comparison).filter(k => /q\d+$/i.test(k));
            if (numericKeys.length === 0) {
                for (const src of sources) {
                    if (!src) continue;
                    numericKeys.push(...Object.keys(src).filter(k => /q\d+$/i.test(k)));
                }
                numericKeys = Array.from(new Set(numericKeys));
            }
            letterKeys.sort();
            numericKeys.sort((a,b) => (parseInt(a.replace(/\D/g,''))||0) - (parseInt(b.replace(/\D/g,''))||0));
            if (numericKeys.length >= letterKeys.length) {
                let bestStart = 0, found = false;
                for (let i=0; i+letterKeys.length-1 < numericKeys.length; i++) {
                    const first = parseInt(numericKeys[i].replace(/\D/g,''));
                    const last = parseInt(numericKeys[i+letterKeys.length-1].replace(/\D/g,''));
                    if (!isNaN(first) && !isNaN(last) && (last - first + 1) === letterKeys.length) { bestStart = i; found = true; break; }
                }
                const slice = numericKeys.slice(found ? bestStart : 0, (found ? bestStart : 0) + letterKeys.length);
                for (let i=0; i<letterKeys.length; i++) {
                    const lk = letterKeys[i], nk = slice[i];
                    if (!nk) continue;
                    const item = comparison[lk] || {};
                    if (!item.correctAnswer || String(item.correctAnswer).trim() === '') {
                        const nkItem = comparison[nk];
                        let val = nkItem && nkItem.correctAnswer;
                        if (!val) val = getFromSources(nk);
                        if (val != null) item.correctAnswer = val;
                    }
                    if (item.userAnswer == null) item.userAnswer = '';
                    if (item.correctAnswer == null) item.correctAnswer = '';
                    comparison[lk] = item;
                }
            }
        }
        return comparison;
    }
    constructor() {
        this.storage = window.storage;
    }

    async getPracticeRecordsUnified() {
        if (window.PracticeRecordAPI && typeof window.PracticeRecordAPI.list === 'function') {
            try {
                const records = await window.PracticeRecordAPI.list();
                return Array.isArray(records) ? records : [];
            } catch (error) {
                console.warn('[MarkdownExporter] 从 PracticeRecordAPI 获取练习记录失败:', error);
                return [];
            }
        }

        return [];
    }

    /**
     * 导出所有练习记录为 Markdown 格式
     */
    exportToMarkdown() {
        return new Promise((resolve, reject) => {
            try {
                console.log('[MarkdownExporter] 开始导出过程');
                
                // 显示进度指示器
                this.showProgressIndicator();
                
                // 设置超时机制
                const timeout = setTimeout(() => {
                    this.hideProgressIndicator();
                    reject(new Error('导出超时，请尝试减少数据量'));
                }, 30000); // 30秒超时
                
                // 使用setTimeout避免阻塞UI
                setTimeout(() => {
                    try {
                        this.performExport()
                            .then(result => {
                                clearTimeout(timeout);
                                resolve(result);
                            })
                            .catch(error => {
                                clearTimeout(timeout);
                                this.hideProgressIndicator();
                                reject(error);
                            });
                    } catch (error) {
                        clearTimeout(timeout);
                        this.hideProgressIndicator();
                        reject(error);
                    }
                }, 100);
                
            } catch (error) {
                console.error('Markdown导出失败:', error);
                this.hideProgressIndicator();
                reject(error);
            }
        });
    }

    /**
     * 导出所有练习记录为 CSV 明细表
     */
    exportToCsv() {
        return new Promise((resolve, reject) => {
            try {
                console.log('[MarkdownExporter] 开始导出 CSV 表格');
                this.showProgressIndicator();

                const timeout = setTimeout(() => {
                    this.hideProgressIndicator();
                    reject(new Error('导出超时，请尝试减少数据量'));
                }, 30000);

                setTimeout(() => {
                    try {
                        this.performCsvExport()
                            .then(result => {
                                clearTimeout(timeout);
                                resolve(result);
                            })
                            .catch(error => {
                                clearTimeout(timeout);
                                this.hideProgressIndicator();
                                reject(error);
                            });
                    } catch (error) {
                        clearTimeout(timeout);
                        this.hideProgressIndicator();
                        reject(error);
                    }
                }, 100);
            } catch (error) {
                console.error('CSV导出失败:', error);
                this.hideProgressIndicator();
                reject(error);
            }
        });
    }

    /**
     * 执行实际的导出操作
     */
    async performExport() {
        try {
            // 尝试从不同的数据源获取记录
            let practiceRecords = [];
            let examIndex = [];
            
            this.updateProgress('正在加载数据...');
            
            // 让出控制权
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 只使用统一 PracticeRecordAPI 数据
            practiceRecords = await this.getPracticeRecordsUnified();

            // examIndex 仍从存储/全局读取
            if (this.storage && typeof this.storage.get === 'function') {
                try {
                    const idx = await this.storage.get('exam_index', []);
                    examIndex = Array.isArray(idx) ? idx : [];
                } catch (_) {
                    examIndex = [];
                }
            }
            if ((!Array.isArray(examIndex) || examIndex.length === 0) && window.examIndex) {
                examIndex = Array.isArray(window.examIndex) ? window.examIndex : [];
            }
            
            if (practiceRecords.length === 0) {
                throw new Error('没有练习记录可导出');
            }

            console.log(`[MarkdownExporter] 找到 ${practiceRecords.length} 条记录`);
            
            // 限制记录数量避免卡死
            // 不再强制截断，保留全部记录（当前数据量约160条）

            this.updateProgress('正在处理数据...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 使用数据一致性管理器确保数据质量
            if (window.DataConsistencyManager) {
                const manager = new DataConsistencyManager();
                
                // 生成数据质量报告
                const qualityReport = manager.getDataQualityReport(practiceRecords);
                console.log('[MarkdownExporter] 数据质量报告:', qualityReport);
                
                // 修复数据不一致问题
                practiceRecords = await this.processRecordsInBatches(practiceRecords, manager);
                console.log('[MarkdownExporter] 数据一致性修复完成');
                
                // 验证修复结果
                const postFixReport = manager.getDataQualityReport(practiceRecords);
                console.log('[MarkdownExporter] 修复后质量报告:', postFixReport);
            }

            this.updateProgress('正在生成内容...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 按日期分组记录
            const recordsByDate = await this.groupRecordsByDateAsync(practiceRecords, examIndex);
            
            // 生成 Markdown 内容
            const markdownContent = await this.generateMarkdownContentAsync(recordsByDate);
            
            this.updateProgress('正在下载文件...');
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // 下载文件
            this.downloadMarkdownFile(markdownContent);
            
            this.hideProgressIndicator();
            
            return markdownContent;
            
        } catch (error) {
            console.error('Markdown导出失败:', error);
            this.hideProgressIndicator();
            throw error;
        }
    }

    /**
     * 执行 CSV 明细表导出
     */
    async performCsvExport() {
        try {
            this.updateProgress('正在加载数据...');
            await new Promise(resolve => setTimeout(resolve, 10));

            const practiceRecords = await this.getPracticeRecordsUnified();
            if (practiceRecords.length === 0) {
                throw new Error('没有练习记录可导出');
            }

            let examIndex = [];
            if (this.storage && typeof this.storage.get === 'function') {
                try {
                    const idx = await this.storage.get('exam_index', []);
                    examIndex = Array.isArray(idx) ? idx : [];
                } catch (_) {
                    examIndex = [];
                }
            }
            if ((!Array.isArray(examIndex) || examIndex.length === 0) && window.examIndex) {
                examIndex = Array.isArray(window.examIndex) ? window.examIndex : [];
            }

            this.updateProgress('正在生成表格...');
            const recordsByDate = await this.groupRecordsByDateAsync(practiceRecords, examIndex);
            const csvContent = this.generateCsvContent(recordsByDate);

            this.updateProgress('正在下载文件...');
            await new Promise(resolve => setTimeout(resolve, 10));
            this.downloadCsvFile(csvContent);

            this.hideProgressIndicator();
            return csvContent;
        } catch (error) {
            console.error('CSV导出失败:', error);
            this.hideProgressIndicator();
            throw error;
        }
    }

    /**
     * 批量处理记录以避免阻塞
     */
    async processRecordsInBatches(practiceRecords, manager) {
        const batchSize = 10;
        const processedRecords = [];
        
        for (let i = 0; i < practiceRecords.length; i += batchSize) {
            const batch = practiceRecords.slice(i, i + batchSize);
            
            for (let j = 0; j < batch.length; j++) {
                const record = batch[j];
                try {
                    const processed = manager.ensureConsistency ? manager.ensureConsistency(record) : record;
                    processedRecords.push(processed);
                } catch (error) {
                    console.warn('[MarkdownExporter] 处理记录失败:', error);
                    processedRecords.push(record); // 使用原始记录
                }
            }
            
            // 每处理一批就让出控制权
            if (i + batchSize < practiceRecords.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
                this.updateProgress(`正在处理数据... (${Math.min(i + batchSize, practiceRecords.length)}/${practiceRecords.length})`);
            }
        }
        
        return processedRecords;
    }

    /**
     * 异步按日期分组记录
     */
    async groupRecordsByDateAsync(practiceRecords, examIndex) {
        const grouped = {};
        
        for (let i = 0; i < practiceRecords.length; i++) {
            const record = practiceRecords[i];
            
            // 获取日期字符串 (YYYY-MM-DD)
            const date = new Date(record.startTime || record.date).toISOString().split('T')[0];
            
            if (!grouped[date]) {
                grouped[date] = [];
            }
            
            // 获取考试信息
            const exam = examIndex.find(e => e.id === record.examId);
            const enhancedRecord = {
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || '未知题目',
                category: exam?.category || record.category || 'Unknown',
                frequency: exam?.frequency || record.frequency || 'unknown'
            };
            
            grouped[date].push(enhancedRecord);
            
            // 每处理20条记录就让出控制权
            if (i % 20 === 19) {
                await new Promise(resolve => setTimeout(resolve, 5));
            }
        }
        
        return grouped;
    }

    /**
     * 按日期分组记录（同步版本，保持兼容性）
     */
    groupRecordsByDate(practiceRecords, examIndex = []) {
        const grouped = {};
        
        (Array.isArray(practiceRecords) ? practiceRecords : []).forEach(record => {
            // 获取日期字符串 (YYYY-MM-DD)
            const date = new Date(record.startTime || record.date).toISOString().split('T')[0];
            
            if (!grouped[date]) {
                grouped[date] = [];
            }
            
            // 获取考试信息
            const exam = examIndex.find(e => e.id === record.examId);
            const enhancedRecord = {
                ...record,
                examInfo: exam || {},
                title: exam?.title || record.title || '未知题目',
                category: exam?.category || record.category || 'Unknown',
                frequency: exam?.frequency || record.frequency || 'unknown'
            };
            
            grouped[date].push(enhancedRecord);
        });
        
        return grouped;
    }

    /**
     * 异步生成 Markdown 内容
     */
    async generateMarkdownContentAsync(recordsByDate) {
        recordsByDate = this.normalizeRecordsByDate(recordsByDate);
        let markdown = '# IELTS 练习记录\n\n';
        markdown += `导出时间：${new Date().toLocaleString()}\n\n`;
        
        // 按日期排序（最新的在前）
        const sortedDates = Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));
        markdown += this.generateSummaryTable(recordsByDate, sortedDates);
        
        // 处理全部日期（当前数据量可承受）
        const datesToProcess = sortedDates;
        
        for (let i = 0; i < datesToProcess.length; i++) {
            const date = datesToProcess[i];
            const records = recordsByDate[date];
            
            // 更新进度
            this.updateProgress(`正在处理 ${date} 的记录... (${i + 1}/${datesToProcess.length})`);
            
            // 添加日期标题
            markdown += `## ${date}\n\n`;
            
            // 处理当天全部记录
            const recordsToProcess = records;
            
            for (let j = 0; j < recordsToProcess.length; j++) {
                const record = recordsToProcess[j];
                try {
                    const recordMarkdown = this.generateRecordMarkdown(record);
                    markdown += recordMarkdown;
                    markdown += '\n\n'; // 记录之间空两行
                } catch (error) {
                    console.warn('[MarkdownExporter] 生成记录Markdown失败:', error);
                    markdown += `### 记录处理失败: ${record.id || 'unknown'}\n\n`;
                }
                
                // 每处理5条记录就让出控制权
                if (j % 5 === 4) {
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            }
            
            // 每处理完一个日期就让出控制权
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        return markdown;
    }

    /**
     * 生成 Markdown 内容（同步版本，保持兼容性）
     */
    generateMarkdownContent(recordsByDate) {
        recordsByDate = this.normalizeRecordsByDate(recordsByDate);
        let markdown = '# IELTS 练习记录\n\n';
        markdown += `导出时间：${new Date().toLocaleString()}\n\n`;
        
        // 按日期排序（最新的在前）
        const sortedDates = Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));
        markdown += this.generateSummaryTable(recordsByDate, sortedDates);
        
        for (let i = 0; i < sortedDates.length; i++) {
            const date = sortedDates[i];
            const records = recordsByDate[date];
            
            // 添加日期标题
            markdown += `## ${date}\n\n`;
            
            for (let j = 0; j < records.length; j++) {
                const record = records[j];
                markdown += this.generateRecordMarkdown(record);
                markdown += '\n\n'; // 记录之间空两行
            }
        }
        
        return markdown;
    }

    /**
     * 生成单个记录的 Markdown
     */
    generateRecordMarkdown(record) {
        const display = this.resolveRecordDisplay(record);
        const metrics = this.resolveScoreMetrics(record);
        
        let markdown = `### ${this.cleanAnswerText(display.title, 120)}\n\n`;
        markdown += '| 项目 | 内容 |\n';
        markdown += '| ---- | ---- |\n';
        markdown += `| 日期 | ${display.date} |\n`;
        markdown += `| 类型 | ${this.cleanAnswerText(display.category, 60)} |\n`;
        markdown += `| 难度/频率 | ${this.cleanAnswerText(display.frequency, 60)} |\n`;
        markdown += `| 得分 | ${metrics.correct}/${metrics.total} |\n`;
        markdown += `| 正确率 | ${metrics.percentage}% |\n`;
        markdown += `| 完成用时 | ${this.formatRecordDuration(record)} |\n`;
        markdown += `| 已标错因 | ${this.countWrongReasonRows(record)} |\n\n`;
        
        // 如果有详细答题数据，生成表格
        if (this.hasAnswerDetails(record)) {
            markdown += this.generateAnswerTable(record.realData || {}, record);
        } else {
            markdown += '暂无逐题答题明细。\n';
        }
        
        return markdown;
    }

    generateSummaryTable(recordsByDate, sortedDates = null) {
        recordsByDate = this.normalizeRecordsByDate(recordsByDate);
        const dates = sortedDates || Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));
        let table = '## 总览\n\n';
        table += '| 日期 | 题目 | 类型 | 难度/频率 | 得分 | 正确率 | 完成用时 | 已标错因 |\n';
        table += '| ---- | ---- | ---- | --------- | ---- | ------ | -------- | -------- |\n';

        dates.forEach(date => {
            (recordsByDate[date] || []).forEach(record => {
                const display = this.resolveRecordDisplay(record, date);
                const metrics = this.resolveScoreMetrics(record);
                table += `| ${display.date} | ${this.cleanAnswerText(display.title, 120)} | ${this.cleanAnswerText(display.category, 60)} | ${this.cleanAnswerText(display.frequency, 60)} | ${metrics.correct}/${metrics.total} | ${metrics.percentage}% | ${this.formatRecordDuration(record)} | ${this.countWrongReasonRows(record)} |\n`;
            });
        });

        return `${table}\n`;
    }

    generateCsvContent(recordsByDate) {
        recordsByDate = this.normalizeRecordsByDate(recordsByDate);
        const headers = [
            '日期',
            '题目',
            '类型',
            '难度/频率',
            '得分',
            '总题数',
            '正确率',
            '完成用时',
            '用时秒',
            '题号',
            '我的答案',
            '正确答案',
            '结果',
            '错因分类',
            '错因备注',
            '记录ID'
        ];
        const rows = [headers];
        const sortedDates = Object.keys(recordsByDate).sort((a, b) => b.localeCompare(a));

        sortedDates.forEach(date => {
            (recordsByDate[date] || []).forEach(record => {
                const display = this.resolveRecordDisplay(record, date);
                const metrics = this.resolveScoreMetrics(record);
                const answerRows = this.getAnswerRows(record);
                if (answerRows.length === 0) {
                    rows.push([
                        display.date,
                        display.title,
                        display.category,
                        display.frequency,
                        metrics.correct,
                        metrics.total,
                        `${metrics.percentage}%`,
                        this.formatRecordDuration(record),
                        this.resolveDurationSeconds(record) ?? '',
                        '',
                        '',
                        '',
                        '',
                        '',
                        '',
                        record.id || record.sessionId || ''
                    ]);
                    return;
                }

                answerRows.forEach(answer => {
                    rows.push([
                        display.date,
                        display.title,
                        display.category,
                        display.frequency,
                        metrics.correct,
                        metrics.total,
                        `${metrics.percentage}%`,
                        this.formatRecordDuration(record),
                        this.resolveDurationSeconds(record) ?? '',
                        answer.question,
                        answer.userAnswer,
                        answer.correctAnswer,
                        answer.isCorrect ? '正确' : '错误',
                        answer.wrongReason?.category || '',
                        answer.wrongReason?.note || '',
                        record.id || record.sessionId || ''
                    ]);
                });
            });
        });

        return `\ufeff${rows.map(row => row.map(cell => this.escapeCsvCell(cell)).join(',')).join('\r\n')}\r\n`;
    }

    resolveScoreMetrics(record) {
        const rd = record.realData || {};
        const scoreInfo = record.scoreInfo || rd.scoreInfo || {};

        const totalFromRecord = typeof record.totalQuestions === 'number' ? record.totalQuestions : null;
        const totalFromScoreInfo = typeof scoreInfo.total === 'number' ? scoreInfo.total : null;
        const totalFromAnswers = record.answers ? Object.keys(record.answers).length
            : (rd.answers ? Object.keys(rd.answers).length : null);
        const totalFromComparison = record.answerComparison ? Object.keys(record.answerComparison).length : null;
        let total = totalFromRecord ?? totalFromScoreInfo ?? totalFromAnswers ?? totalFromComparison ?? 0;

        let correct = null;
        if (typeof record.correctAnswers === 'number') correct = record.correctAnswers;
        if (correct == null && typeof scoreInfo.correct === 'number') correct = scoreInfo.correct;
        if (correct == null && typeof record.score === 'number') {
            if (total && record.score <= total) {
                correct = record.score;
            }
        }
        if (correct == null && record.answerComparison) {
            try {
                correct = Object.values(record.answerComparison).filter(item => item && item.isCorrect).length;
            } catch (_) {}
        }
        if (correct == null) correct = 0;

        let percentage = null;
        if (typeof record.percentage === 'number') percentage = record.percentage;
        else if (typeof scoreInfo.percentage === 'number') percentage = scoreInfo.percentage;
        else if (typeof record.accuracy === 'number') percentage = Math.round(record.accuracy * 100);

        if ((!total || total <= 0) && percentage == null) {
            total = totalFromAnswers ?? totalFromComparison ?? 0;
        }
        if ((!total || total <= 0) && correct > 0) {
            total = correct;
        }
        if (!total || total <= 0) total = 0;

        if ((percentage == null || percentage > 100 || percentage < 0) && total > 0) {
            percentage = Math.round((correct / total) * 100);
        }
        if (percentage == null) percentage = 0;

        if (total > 0 && correct > total) {
            // 说明 score 字段可能是百分比
            correct = Math.round((percentage / 100) * total);
        }

        return {
            correct,
            total,
            percentage: Math.max(0, Math.min(100, Math.round(percentage)))
        };
    }

    /**
     * 生成答题表格
     */
    generateAnswerTable(realData, record) {
        try {
            const rows = this.getAnswerRows({ ...record, realData });
            let table = '| 题号 | 我的答案 | 正确答案 | 结果 | 错因 |\n';
            table += '| ---- | -------- | -------- | ---- | ---- |\n';
            rows.forEach(row => {
                const result = row.isCorrect ? '正确' : '错误';
                const wrongReason = row.isCorrect ? '' : this.formatWrongReason(row.wrongReason);
                table += `| ${this.cleanAnswerText(row.question, 40)} | ${this.cleanAnswerText(row.userAnswer || '未作答')} | ${this.cleanAnswerText(row.correctAnswer || 'N/A')} | ${result} | ${wrongReason} |\n`;
            });
            return table;
        } catch (error) {
            console.error('[MarkdownExporter] 生成答题表格失败:', error);
            return '答题详情生成失败\n';
        }
    }

    /**
     * 从answerComparison生成表格
     */
    generateTableFromComparison(answerComparison, record = null) {
        // 支持将 keys 中的非数字后缀/前缀保留下来，比如 qa/qb 显示为 a/b

        try {
            const rows = this.getAnswerRows({ ...(record || {}), answerComparison });
            let table = '| 题号 | 我的答案 | 正确答案 | 结果 | 错因 |\n';
            table += '| ---- | -------- | -------- | ---- | ---- |\n';
            rows.forEach(row => {
                const result = row.isCorrect ? '正确' : '错误';
                const wrongReason = row.isCorrect ? '' : this.formatWrongReason(row.wrongReason);
                table += `| ${this.cleanAnswerText(row.question, 40)} | ${this.cleanAnswerText(row.userAnswer || '未作答')} | ${this.cleanAnswerText(row.correctAnswer || 'N/A')} | ${result} | ${wrongReason} |\n`;
            });
            return table;
        } catch (error) {
            console.error('[MarkdownExporter] 从比较数据生成表格失败:', error);
            return '答题详情生成失败\n';
        }
    }

    getAnswerRows(record = {}) {
        const realData = record.realData || {};
        const comparison = record.answerComparison || realData.answerComparison || null;
        const hasComparison = comparison && Object.keys(comparison).length > 0;
        if (hasComparison) {
            return this.getAnswerRowsFromComparison(comparison, record);
        }

        const answers = record.answers || realData.answers || {};
        const correctAnswers = this.getCorrectAnswers(record);
        const detailSources = record.answerDetails
            || record.scoreInfo?.details
            || realData.scoreInfo?.details
            || {};
        const questionNumbers = this.extractQuestionNumbers(
            answers && Object.keys(answers).length ? answers : {},
            correctAnswers,
            comparison || {}
        );
        const maxQuestions = 50;
        const questionsToProcess = questionNumbers.slice(0, maxQuestions);
        if (questionNumbers.length > maxQuestions) {
            console.warn(`[MarkdownExporter] 题目过多，只导出前${maxQuestions}题`);
        }

        return questionsToProcess.map(qNum => {
            const detailKeyCandidates = [`q${qNum}`, qNum.toString()];
            let userAnswer = this.getUserAnswer(answers, qNum);
            if (!userAnswer && detailSources && typeof detailSources === 'object') {
                for (const k of detailKeyCandidates) {
                    if (detailSources[k]) {
                        const detail = detailSources[k];
                        userAnswer = detail.userAnswer ?? detail.answer ?? userAnswer;
                        break;
                    }
                }
            }
            const correctAnswer = this.getCorrectAnswer(correctAnswers, qNum);
            const isCorrect = this.compareAnswers(userAnswer, correctAnswer);
            return {
                question: qNum,
                userAnswer: userAnswer || '未作答',
                correctAnswer: correctAnswer || 'N/A',
                isCorrect,
                wrongReason: isCorrect ? null : this.getWrongReason(record, `q${qNum}`, qNum.toString())
            };
        });
    }

    getAnswerRowsFromComparison(answerComparison, record = {}) {
        const merged = this.mergeComparisonWithCorrections({ ...record, answerComparison });
        const noiseKeys = new Set(['volume-slider', 'playback-speed', 'playbackspeed', 'volume']);
        const correctMap = record ? this.getCorrectAnswers(record) : {};
        const sortedKeys = Object.keys(merged)
            .filter(k => !noiseKeys.has(k))
            .filter(k => {
                const entry = merged[k];
                return entry && (entry.userAnswer || entry.user || entry.correctAnswer || entry.correct);
            })
            .sort((a, b) => {
                const numA = parseInt(a.replace(/\D/g, ''), 10);
                const numB = parseInt(b.replace(/\D/g, ''), 10);
                if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
                if (!Number.isNaN(numA)) return -1;
                if (!Number.isNaN(numB)) return 1;
                return a.localeCompare(b);
            });
        const maxQuestions = 50;
        const keysToProcess = sortedKeys.slice(0, maxQuestions);
        if (sortedKeys.length > maxQuestions) {
            console.warn(`[MarkdownExporter] 题目过多，只导出前${maxQuestions}题`);
        }

        return keysToProcess.map(key => {
            const comparison = merged[key] || {};
            let questionNum = key.replace(/\D/g, '');
            if (!questionNum) {
                questionNum = key.replace(/^q/i, '');
            }
            const userAnswer = comparison.userAnswer || comparison.user || '未作答';
            const canonicalCorrect = correctMap[key]
                ?? (questionNum ? this.getCorrectAnswer(correctMap, questionNum) : null);
            const correctAnswer = canonicalCorrect || comparison.correctAnswer || comparison.correct || 'N/A';
            const isCorrect = canonicalCorrect
                ? this.compareAnswers(userAnswer, canonicalCorrect)
                : !!comparison.isCorrect;
            return {
                question: questionNum || key,
                userAnswer,
                correctAnswer,
                isCorrect,
                wrongReason: isCorrect ? null : this.getWrongReason(record, key, questionNum, comparison)
            };
        });
    }

    getWrongReason(record = {}, key, displayQuestionNum = null, comparison = null) {
        const candidates = [
            comparison?.wrongReason,
            comparison?.errorReason,
            record?.wrongReasons?.[key],
            displayQuestionNum != null ? record?.wrongReasons?.[`q${displayQuestionNum}`] : null,
            displayQuestionNum != null ? record?.wrongReasons?.[String(displayQuestionNum)] : null,
            record?.answerComparison?.[key]?.wrongReason,
            displayQuestionNum != null ? record?.answerComparison?.[`q${displayQuestionNum}`]?.wrongReason : null,
            record?.answerDetails?.[key]?.wrongReason,
            displayQuestionNum != null ? record?.answerDetails?.[`q${displayQuestionNum}`]?.wrongReason : null,
            record?.scoreInfo?.details?.[key]?.wrongReason,
            displayQuestionNum != null ? record?.scoreInfo?.details?.[`q${displayQuestionNum}`]?.wrongReason : null,
            record?.realData?.answerComparison?.[key]?.wrongReason,
            displayQuestionNum != null ? record?.realData?.answerComparison?.[`q${displayQuestionNum}`]?.wrongReason : null,
            record?.realData?.scoreInfo?.details?.[key]?.wrongReason,
            displayQuestionNum != null ? record?.realData?.scoreInfo?.details?.[`q${displayQuestionNum}`]?.wrongReason : null
        ];
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (typeof candidate === 'string' && candidate.trim()) {
                return { category: candidate.trim(), note: '' };
            }
            if (typeof candidate === 'object') {
                const category = String(candidate.category || candidate.reason || candidate.type || '').trim();
                const note = String(candidate.note || candidate.detail || candidate.text || '').trim();
                if (category || note) {
                    return { category, note };
                }
            }
        }
        return null;
    }

    formatWrongReason(reason) {
        if (!reason) return '';
        const category = String(reason.category || '').trim();
        const note = String(reason.note || '').trim();
        const text = [category, note].filter(Boolean).join(' - ');
        return this.cleanAnswerText(text, 180);
    }

    countWrongReasonRows(record = {}) {
        try {
            return this.getAnswerRows(record).filter(row => !row.isCorrect && this.formatWrongReason(row.wrongReason)).length;
        } catch (error) {
            console.warn('[MarkdownExporter] 统计错因数量失败:', error);
            return 0;
        }
    }

    resolveRecordDisplay(record = {}, fallbackDate = null) {
        const metadata = record.metadata || {};
        const displayTitle = this.normalizeTitle(
            metadata.examTitle
            || metadata.title
            || record.title
            || record.examId
            || '未知题目'
        );
        return {
            title: displayTitle,
            category: metadata.category || record.category || 'Unknown',
            frequency: metadata.frequency || record.frequency || 'unknown',
            date: fallbackDate || this.formatRecordDate(record)
        };
    }

    formatRecordDate(record = {}) {
        const raw = record.startTime || record.date || record.endTime || record.createdAt;
        if (!raw) return '未知日期';
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return '未知日期';
        return date.toISOString().split('T')[0];
    }

    normalizeRecordsByDate(value) {
        if (Array.isArray(value)) {
            return this.groupRecordsByDate(value, []);
        }
        if (!value || typeof value !== 'object') {
            return {};
        }
        const normalized = {};
        Object.entries(value).forEach(([date, records]) => {
            normalized[date] = Array.isArray(records) ? records : [];
        });
        return normalized;
    }

    resolveDurationSeconds(record = {}) {
        if (
            record.durationUnknown === true
            || record.timePrecision === 'date-only'
            || record.source === 'markdown-recovery'
            || record.recoveredFrom
        ) {
            const known = Number(record.duration ?? record.elapsedSeconds);
            return Number.isFinite(known) && known > 0 ? known : null;
        }
        const numeric = Number(record.duration ?? record.elapsedSeconds);
        return Number.isFinite(numeric) ? numeric : null;
    }

    formatRecordDuration(record = {}) {
        const seconds = this.resolveDurationSeconds(record);
        return seconds == null ? '未记录' : this.formatDuration(seconds);
    }

    formatDuration(seconds) {
        const totalSeconds = Number(seconds) || 0;
        if (totalSeconds <= 0) return '0秒';
        const minutes = Math.floor(totalSeconds / 60);
        const rest = totalSeconds % 60;
        if (minutes <= 0) return `${rest}秒`;
        return rest ? `${minutes}分${rest}秒` : `${minutes}分`;
    }

    escapeCsvCell(value) {
        if (value == null) return '';
        const text = String(value).replace(/\r?\n/g, ' ');
        if (/[",\r\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    /**
     * 清理答案文本，避免Markdown格式问题
     */
    cleanAnswerText(text, maxLength = 100) {
        if (!text) return '';
        
        return String(text)
            .replace(/\|/g, '\\|')  // 转义管道符
            .replace(/\n/g, ' ')    // 替换换行符
            .replace(/\r/g, '')     // 移除回车符
            .trim()
            .substring(0, maxLength); // 限制长度
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswers(record) {
        const coreContracts = window.PracticeCore && window.PracticeCore.contracts;
        if (!coreContracts || typeof coreContracts.resolveRecordCorrectAnswerMap !== 'function') {
            throw new Error('MarkdownExporter requires PracticeCore.contracts.resolveRecordCorrectAnswerMap');
        }
        const correctAnswers = coreContracts.resolveRecordCorrectAnswerMap(record);
        if (Object.keys(correctAnswers).length > 0) {
            return correctAnswers;
        }
        
        // fallback：若answers有值且无正确答案，至少返回题号以生成表格
        if (record.answers && Object.keys(record.answers).length > 0) {
            const stub = {};
            Object.keys(record.answers).forEach(key => { stub[key] = ''; });
            return stub;
        }
        
        console.warn('[MarkdownExporter] 未找到正确答案数据，记录ID:', record.id);
        return {};
    }

    /**
     * 提取题目编号
     */
    extractQuestionNumbers(userAnswers, correctAnswers, comparison = {}) {
        const allQuestions = new Set();
        
        const addFrom = (obj) => {
            Object.keys(obj || {}).forEach(key => {
                const num = this.extractNumber(key);
                if (num) allQuestions.add(num);
            });
        };
        
        // 从用户答案/正确答案提取
        addFrom(userAnswers || {});
        addFrom(correctAnswers || {});
        addFrom(comparison || {});
        
        // 如果没有找到题目，生成默认序号
        if (allQuestions.size === 0) {
            const maxQuestions = Math.max(
                Object.keys(userAnswers).length,
                Object.keys(correctAnswers).length,
                13 // 默认最大题目数
            );
            for (let i = 1; i <= maxQuestions; i++) {
                allQuestions.add(i);
            }
        }
        
        return Array.from(allQuestions).sort((a, b) => a - b);
    }

    /**
     * 从键名中提取数字
     */
    extractNumber(key) {
        const match = key.match(/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * 获取用户答案
     */
    getUserAnswer(answers, questionNum) {
        // 尝试不同的键名格式
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (answers[key] !== undefined) {
                const answer = answers[key];
                // 如果是数组（历史记录），取最后一个
                if (Array.isArray(answer)) {
                    return answer[answer.length - 1]?.value || answer[answer.length - 1];
                }
                return answer;
            }
        }
        
        return null;
    }

    /**
     * 获取正确答案
     */
    getCorrectAnswer(correctAnswers, questionNum) {
        const possibleKeys = [`q${questionNum}`, `question${questionNum}`, questionNum.toString()];
        
        for (const key of possibleKeys) {
            if (correctAnswers[key] !== undefined) {
                return correctAnswers[key];
            }
        }
        
        return null;
    }

    /**
     * 比较答案
     */
    compareAnswers(userAnswer, correctAnswer) {
        if (!userAnswer || !correctAnswer) {
            return false;
        }
        
        // 标准化答案进行比较
        const normalize = (str) => String(str).trim().toLowerCase();
        return normalize(userAnswer) === normalize(correctAnswer);
    }

    /**
     * 显示进度指示器
     */
    showProgressIndicator() {
        // 移除已存在的进度指示器
        this.hideProgressIndicator();
        
        const progressHtml = `
            <div id="export-progress-overlay" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            ">
                <div style="
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    min-width: 300px;
                ">
                    <div style="margin-bottom: 15px;">
                        <div style="
                            width: 40px;
                            height: 40px;
                            border: 4px solid #f3f3f3;
                            border-top: 4px solid #3498db;
                            border-radius: 50%;
                            animation: spin 1s linear infinite;
                            margin: 0 auto;
                        "></div>
                    </div>
                    <div id="export-progress-text">正在准备导出...</div>
                </div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        `;
        
        document.body.insertAdjacentHTML('beforeend', progressHtml);
    }

    /**
     * 更新进度文本
     */
    updateProgress(text) {
        const progressText = document.getElementById('export-progress-text');
        if (progressText) {
            progressText.textContent = text;
        }
    }

    /**
     * 隐藏进度指示器
     */
    hideProgressIndicator() {
        const overlay = document.getElementById('export-progress-overlay');
        if (overlay) {
            overlay.remove();
        }
    }

    /**
     * 下载 Markdown 文件
     */
    downloadMarkdownFile(content) {
        try {
            const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            a.href = url;
            a.download = `ielts-practice-records-${new Date().toISOString().split('T')[0]}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('[MarkdownExporter] 文件下载完成');
        } catch (error) {
            console.error('[MarkdownExporter] 文件下载失败:', error);
            throw error;
        }
    }

    /**
     * 下载 CSV 明细表
     */
    downloadCsvFile(content) {
        try {
            const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');

            a.href = url;
            a.download = `ielts-practice-records-table-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('[MarkdownExporter] CSV 文件下载完成');
        } catch (error) {
            console.error('[MarkdownExporter] CSV 文件下载失败:', error);
            throw error;
        }
    }
}

// 导出类
window.MarkdownExporter = MarkdownExporter;
window.exportPracticeTableData = async function exportPracticeTableData() {
    const exporter = new MarkdownExporter();
    return exporter.exportToCsv();
};
