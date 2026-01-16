const { kv } = require('@vercel/kv');
const { parse } = require('csv-parse/sync');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { officeCsv, attendanceCsv, cboReportCsv, salesCsv } = req.body;
        const results = {
            summary: {
                totalOvertime: 0,
                fieldOvertime: 0,
                officeOvertime: 0,
                holidayWorkHours: 0
            },
            employees: new Map(),
            officeDetails: [],
            cboDetails: [],
            // 管理メンバーの取得
            async function getManagementMembers() {
                const members = new Map();
        try {
            const ids = await kv.smembers('employees:all');
            if (!ids) return members;

            for (const id of ids) {
                const data = await kv.get(`employee:${id}`);
                if (data && data.department === 'management') {
                    const normName = normalizeName(data.name);
                    members.set(normName, { ...data, normName });
                    if (data.cboName) {
                        members.set(normalizeName(data.cboName), { ...data, normName });
                    }
                }
            }
        } catch (e) {
            console.error('Failed to fetch members:', e);
        }
        return members;
    }

    // ========================================
    // 1. 事務残業CSV処理
    // A:作業日 B:報告者 C:案件名 D:作業時間 E:作業時間合計 F:残業時間(時刻) G:作業内容
    // ========================================
    function parseOfficeCsv(csvContent, members, results) {
        let records;
        try {
            records = parse(csvContent.trim(), {
                columns: true,
                skip_empty_lines: true,
                relax_quotes: true,
                relax_column_count: true,
                skip_records_with_error: true
            });
        } catch (e) {
            console.error('Office CSV Parse Error:', e);
            return;
        }

        for (const row of records) {
            const rawName = row['報告者'] || '';
            const normName = normalizeName(rawName);
            if (!members.has(normName)) continue;

            const member = members.get(normName);
            ensureEmployee(results.employees, member);

            const emp = results.employees.get(member.id);

            // F列: 残業時間 (時刻形式 "2:30")
            const overtimeHours = parseTimeToHours(row['残業時間'] || '');
            emp.officeOvertimeHours = (emp.officeOvertimeHours || 0) + overtimeHours;

            // 作業内容のカテゴリ分類
            const taskContent = row['作業内容'] || '';
            if (!emp.taskCategories) emp.taskCategories = {};

            // カテゴリ判定（キーワードマッチング）
            let category = 'その他';
            if (taskContent.includes('作図')) category = '作図';
            else if (taskContent.includes('見積') || taskContent.includes('積算')) category = '見積もり';
            else if (taskContent.includes('雑務')) category = '雑務';
            else if (taskContent.includes('打合') || taskContent.includes('会議')) category = '打合せ・会議';
            else if (taskContent.includes('移動')) category = '移動';

            emp.taskCategories[category] = (emp.taskCategories[category] || 0) + overtimeHours;

            // 詳細リストに追加
            if (overtimeHours > 0) {
                results.officeDetails.push({
                    date: row['作業日'] || '',
                    name: member.name,
                    project: row['案件名'] || '',
                    task: taskContent,
                    hours: overtimeHours,
                    category: category
                });
            }
        }
    }

    // ========================================
    // 2. 出勤簿CSV処理
    // A:日付 B:曜日 C:報告者 H:残業(h) J:休出(h) N:有給 O:代休
    // → 日付×社員のマップを作成（半休・休日出勤判定用）
    // ========================================
    function parseAttendanceCsv(csvContent, members, results) {
        let records;
        try {
            records = parse(csvContent.trim(), {
                columns: true,
                skip_empty_lines: true,
                relax_column_count: true,
                skip_records_with_error: true
            });
        } catch (e) {
            console.error('Attendance CSV Parse Error:', e);
            return;
        }

        // 日付×社員の勤怠情報マップ
        if (!results.attendanceMap) results.attendanceMap = new Map();

        for (const row of records) {
            const rawName = row['報告者'] || '';
            const normName = normalizeName(rawName);
            if (!members.has(normName)) continue;

            const member = members.get(normName);
            ensureEmployee(results.employees, member);

            const emp = results.employees.get(member.id);

            // H列: 残業(h)
            const overtimeHours = parseFloat(row['残業(h)'] || '0') || 0;
            emp.overtimeTotal = (emp.overtimeTotal || 0) + overtimeHours;

            // J列: 休出(h)
            const holidayWorkHours = parseFloat(row['休出(h)'] || '0') || 0;
            if (holidayWorkHours > 0) {
                emp.holidayWorkHours = (emp.holidayWorkHours || 0) + holidayWorkHours;
            }

            // 日付を正規化 (例: "2025/12/10" → "2025年12月10日")
            const dateStr = row['日付'] || '';
            const dateKey = normalizeDate(dateStr);

            // N列・O列: 有給・代休（半日判定用）
            const paidLeave = row['有給'] || '';
            const compensatoryLeave = row['代休'] || '';
            const isHalfDay = paidLeave.includes('半日') || compensatoryLeave.includes('半日');
            const isHolidayWork = holidayWorkHours > 0;

            // マップに保存（日付 + 氏名をキーに）
            const mapKey = `${dateKey}_${member.name}`;
            results.attendanceMap.set(mapKey, {
                isHalfDay,
                isHolidayWork,
                holidayWorkHours
            });
        }
    }

    // ========================================
    // 3. CBO日報CSV処理（報告確認用）
    // 定時: 08:00～17:30
    // 残業: G列（17:30以降）+ L列（08:00以前の早出）
    // ========================================
    function parseCboReportCsv(csvContent, members, results) {
        let records;
        try {
            records = parse(csvContent.trim(), {
                columns: true,
                skip_empty_lines: true,
                relax_quotes: true,
                relax_column_count: true,
                skip_records_with_error: true
            });
        } catch (e) {
            console.error('CBO CSV Parse Error:', e);
            return;
        }

        // 現場判定キーワード（画像分析に基づく）
        const FIELD_KEYWORDS_REGULAR = ['現場', '夜間作業', '夜工事', '運搬'];
        const FIELD_KEYWORDS_OVERTIME = ['現場残業', '夜工事残業', '夜間作業', '運搬'];

        // 定時の境界（分単位）
        const REGULAR_START = 8 * 60;  // 08:00 = 480分
        const REGULAR_END = 17 * 60 + 30;  // 17:30 = 1050分

        for (const row of records) {
            const rawName = row['報告者'] || '';
            const normName = normalizeName(rawName);
            if (!members.has(normName)) continue;

            const member = members.get(normName);
            ensureEmployee(results.employees, member);

            const emp = results.employees.get(member.id);

            // 作業日を正規化してマップキー作成
            const workDate = row['作業日'] || '';
            const mapKey = `${workDate}_${member.name}`;
            const attendanceInfo = results.attendanceMap?.get(mapKey) || {};

            // 休日出勤の場合は全て休日出勤時間としてカウント（出勤簿で集計済み）
            if (attendanceInfo.isHolidayWork) {
                continue;
            }

            // セル内改行を分割（\r\n, \n 両対応）
            const workTimes = (row['作業時間'] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const workContents = (row['作業内容（管理者日報）'] || row['作業内容(管理者日報)'] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            const overtimeTypes = (row['残業種別（管理者日報）'] || row['残業種別(管理者日報)'] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);

            // G列: 残業時間 (17:30以降)
            const overtimeG = parseTimeToHours(row['残業時間'] || '');
            // L列: 早出時間 (08:00以前)
            const earlyL = parseTimeToHours(row['早出時間'] || '');

            // 残業合計 = G + L
            const totalOvertime = overtimeG + earlyL;

            // 定時の境界を決定
            let regularStart = REGULAR_START;  // デフォルト: 08:00
            let regularEnd = REGULAR_END;      // デフォルト: 17:30

            // 半休の場合
            if (attendanceInfo.isHalfDay && workTimes.length > 0) {
                const { startMin } = parseTimeRange(workTimes[0]);

                // 午後からの場合（例: 12:00～17:30）
                if (startMin >= 12 * 60) {
                    regularStart = startMin;  // 開始時刻から17:30まで
                }
                // 午前のみの場合は、08:00～12:00程度で定時終了
            }

            // 各時間帯から定時/残業の現場時間を算出
            let regularFieldHours = 0;
            let regularTotalHours = 0;
            // 定時内合計、残業合計を一度フラットに計算してから分配する方式に変更
            // 「基本は1日8時間」というルールに基づく

            // 時間帯ループでまずは総時間を積み上げ
            // ただし、17:30以降かどうかなどの属性も保持しておく必要があるため、
            // 従来通りループしつつ、バケツに入れる

            let rawRegularMinutes = 0; // 08:00-17:30 の時間（休憩除く）
            let rawLateMinutes = 0;    // 17:30以降の時間
            let rawEarlyMinutes = 0;   // 08:00以前の時間

            let fieldMinutesRegularRange = 0; // 08:00-17:30の現場時間
            let fieldMinutesLateRange = 0;    // 17:30以降の現場時間
            let fieldMinutesEarlyRange = 0;   // 08:00以前の現場時間

            // K列のインデックス追跡用
            let otTypeIndex = 0;

            for (let i = 0; i < workTimes.length; i++) {
                const timeRange = workTimes[i];
                const content = workContents[i] || '';

                // 時間帯をパース
                const { startMin, endMin, durationHours } = parseTimeRange(timeRange);
                if (durationHours <= 0) continue;

                // 定時範囲(08:00-17:30)との重なり
                const regularOverlapStart = Math.max(startMin, regularStart);
                const regularOverlapEnd = Math.min(endMin, regularEnd);
                let incrementRegular = Math.max(0, regularOverlapEnd - regularOverlapStart);

                // 残業時間 (定時開始前 + 定時終了後)
                let incrementEarly = Math.max(0, Math.min(endMin, regularStart) - startMin);
                let incrementLate = Math.max(0, endMin - Math.max(startMin, regularEnd));

                // 休憩控除（厳密なまたぎ判定）
                const breaks = [
                    { start: 10 * 60, end: 10 * 60 + 15 },
                    { start: 12 * 60, end: 13 * 60 },
                    { start: 15 * 60, end: 15 * 60 + 15 }
                ];

                // Regular区間からの控除
                if (incrementRegular > 0) {
                    const s = regularOverlapStart;
                    const e = regularOverlapEnd;
                    // またぎ判定：シフト全体(startMin, endMin)で休憩を含んでいるか
                    for (const brk of breaks) {
                        if (startMin <= brk.start && endMin >= brk.end) {
                            // 休憩時間帯がRegular期間と重なっていれば引く
                            const overlap = Math.max(0, Math.min(e, brk.end) - Math.max(s, brk.start));
                            incrementRegular -= overlap;
                        }
                    }
                }

                // Late区間（17:30以降）からの控除（要望にあれば追加、現状なし）

                rawRegularMinutes += incrementRegular;
                rawLateMinutes += incrementLate;
                rawEarlyMinutes += incrementEarly;

                // 現場時間の集計
                if (FIELD_KEYWORDS_REGULAR.some(kw => content.includes(kw))) {
                    if (incrementRegular > 0) fieldMinutesRegularRange += incrementRegular;
                    if (incrementEarly > 0) fieldMinutesEarlyRange += incrementEarly;
                }

                // Late区間はK列判定あり
                if (incrementLate > 0) {
                    const otType = overtimeTypes[otTypeIndex] || '';
                    otTypeIndex++;
                    if (FIELD_KEYWORDS_OVERTIME.some(kw => otType.includes(kw))) {
                        fieldMinutesLateRange += incrementLate;
                    }
                }
            }

            // ============================================
            // 集計ロジック: 「1日8時間」を定時枠として優先充当
            // ============================================

            // 1. まず 08:00-17:30 の実働分は無条件で定時
            let finalRegularMinutes = rawRegularMinutes;
            let finalRegularFieldMinutes = fieldMinutesRegularRange;

            // 2. 定時枠の残り容量（8時間 = 480分）
            const regularCapMinutes = 8 * 60;
            let remainingRegularCapacity = Math.max(0, regularCapMinutes - finalRegularMinutes);

            // 3. 17:30以降（Late）の分を、残り容量があれば定時に充当（遅出対応）
            let finalOvertimeMinutes = rawEarlyMinutes; // 早出はいったん残業として積む
            let finalOvertimeFieldMinutes = fieldMinutesEarlyRange;

            // Late分を分配
            if (rawLateMinutes > 0) {
                // 定時枠に吸い込まれる分
                const absorbToRegular = Math.min(rawLateMinutes, remainingRegularCapacity);
                // 溢れて残業になる分
                const overflowToOvertime = rawLateMinutes - absorbToRegular;

                // 追加定時
                finalRegularMinutes += absorbToRegular;
                // 現場時間の按分（Late全体のうち、現場だった比率を適用）
                const lateFieldRatio = rawLateMinutes > 0 ? (fieldMinutesLateRange / rawLateMinutes) : 0;
                finalRegularFieldMinutes += (absorbToRegular * lateFieldRatio);

                // 追加残業
                finalOvertimeMinutes += overflowToOvertime;
                finalOvertimeFieldMinutes += (overflowToOvertime * lateFieldRatio);
            }

            // 時間単位に変換
            const finalRegularTotal = finalRegularMinutes / 60;
            const finalRegularField = finalRegularFieldMinutes / 60;
            const finalOvertimeTotal = finalOvertimeMinutes / 60; // 変数名修正
            const finalOvertimeField = finalOvertimeFieldMinutes / 60; // 変数名修正

            // 集計
            emp.regularTotal = (emp.regularTotal || 0) + finalRegularTotal;
            emp.regularField = (emp.regularField || 0) + finalRegularField;
            emp.overtimeTotal = (emp.overtimeTotal || 0) + finalOvertimeTotal;
            emp.overtimeField = (emp.overtimeField || 0) + finalOvertimeField;

            // 詳細データに追加
            results.cboDetails.push({
                date: normalizeDate(workDate),
                name: member.name,
                regularTotal: finalRegularTotal,
                regularField: finalRegularField,
                overtimeTotal: finalOvertimeTotal,
                overtimeField: finalOvertimeField,
                holidayWorkHours: 0
            });
        }
    }

    // 時間帯パース (例: "07:00～15:00" → { startMin, endMin, durationHours })
    function parseTimeRange(rangeStr) {
        const result = { startMin: 0, endMin: 0, durationHours: 0 };
        if (!rangeStr || typeof rangeStr !== 'string') return result;
        if (!rangeStr.includes('～') && !rangeStr.includes('~')) return result;

        const [start, end] = rangeStr.split(/[～~]/);
        if (!start || !end) return result;

        const startParts = start.trim().split(':');
        const endParts = end.trim().split(':');

        if (startParts.length !== 2 || endParts.length !== 2) return result;

        result.startMin = (parseInt(startParts[0], 10) || 0) * 60 + (parseInt(startParts[1], 10) || 0);
        result.endMin = (parseInt(endParts[0], 10) || 0) * 60 + (parseInt(endParts[1], 10) || 0);

        // 日またぎ対応
        if (result.endMin < result.startMin) {
            result.endMin += 24 * 60;
        }

        result.durationHours = (result.endMin - result.startMin) / 60;
        return result;
    }

    // ========================================
    // ユーティリティ関数
    // ========================================

    function normalizeDate(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return '';

        // "2025/12/10" → "2025年12月10日"
        const match = dateStr.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
        if (match) {
            return `${match[1]}年${parseInt(match[2])}月${parseInt(match[3])}日`;
        }

        // 既に "2025年12月10日" の場合はそのまま
        return dateStr;
    }

    function ensureEmployee(empMap, member) {
        if (!empMap.has(member.id)) {
            empMap.set(member.id, {
                id: member.id,
                name: member.name,
                regularTotal: 0,
                regularField: 0,
                overtimeTotal: 0,
                overtimeField: 0,
                officeOvertimeHours: 0
            });
        }
    }

    function normalizeName(name) {
        if (!name || typeof name !== 'string') return '';
        return name.replace(/\d+/g, '').replace(/[\s　]+/g, '').trim();
    }

    // "2:30" -> 2.5
    function parseTimeToHours(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return 0;
        const cleaned = timeStr.trim();
        if (!cleaned || cleaned === '-') return 0;

        const parts = cleaned.split(':');
        if (parts.length !== 2) return 0;

        const h = parseInt(parts[0], 10) || 0;
        const m = parseInt(parts[1], 10) || 0;
        return h + m / 60;
    }

    // "08:00～17:30" -> 9.5
    function calculateDuration(rangeStr) {
        if (!rangeStr || typeof rangeStr !== 'string') return 0;
        if (!rangeStr.includes('～') && !rangeStr.includes('~')) return 0;

        const [start, end] = rangeStr.split(/[～~]/);
        if (!start || !end) return 0;

        let startH = parseTimeToHours(start);
        let endH = parseTimeToHours(end);

        // 日またぎ対応
        if (endH < startH) {
            endH += 24;
        }

        return endH - startH;
    }
