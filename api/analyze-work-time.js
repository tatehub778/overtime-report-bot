const { kv } = require('@vercel/kv');
const { parse } = require('csv-parse/sync');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { officeCsv, attendanceCsv, cboCsv } = req.body;

        // 管理メンバー情報の取得
        const managementMembers = await getManagementMembers();

        // 結果オブジェクト
        const results = {
            employees: new Map(),
            officeDetails: []
        };

        // 1. 事務残業CSV処理（オプション）
        if (officeCsv) {
            parseOfficeCsv(officeCsv, managementMembers, results);
        }

        // 2. 出勤簿CSV処理（オプション）
        if (attendanceCsv) {
            parseAttendanceCsv(attendanceCsv, managementMembers, results);
        }

        // 3. CBO日報CSV処理（オプション）
        if (cboCsv) {
            parseCboReportCsv(cboCsv, managementMembers, results);
        }

        // 結果を配列に変換
        const summary = Array.from(results.employees.values()).map(emp => ({
            name: emp.name,
            // 定時内
            regularTotal: round(emp.regularTotal || 0),
            regularField: round(emp.regularField || 0),
            regularOffice: round((emp.regularTotal || 0) - (emp.regularField || 0)),
            // 残業
            overtimeTotal: round(emp.overtimeTotal || 0),
            overtimeField: round(emp.overtimeField || 0),
            overtimeOffice: round((emp.overtimeTotal || 0) - (emp.overtimeField || 0)),
            // 事務残業（従来機能）
            officeOvertimeHours: round(emp.officeOvertimeHours || 0),
            // カテゴリ別
            taskCategories: emp.taskCategories || {}
        }));

        return res.status(200).json({
            summary,
            officeDetails: results.officeDetails
        });

    } catch (error) {
        console.error('Analysis error:', error);
        return res.status(500).json({ error: '分析中にエラーが発生しました', details: error.message });
    }
};

function round(num) {
    return Math.round(num * 100) / 100;
}

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
// A:日付 B:曜日 C:報告者 H:残業(h)数値
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

    for (const row of records) {
        const rawName = row['報告者'] || '';
        const normName = normalizeName(rawName);
        if (!members.has(normName)) continue;

        const member = members.get(normName);
        ensureEmployee(results.employees, member);

        const emp = results.employees.get(member.id);

        // H列: 残業(h) (数値形式 "6.5")
        const overtimeHours = parseFloat(row['残業(h)'] || '0') || 0;
        emp.overtimeTotal = (emp.overtimeTotal || 0) + overtimeHours;
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

    // 現場判定キーワード
    const FIELD_KEYWORDS_REGULAR = ['夜間作業', '現場', '運搬'];
    const FIELD_KEYWORDS_OVERTIME = ['現場残業', '夜工事残業', '運搬'];

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

        // セル内改行を分割
        const workTimes = (row['作業時間'] || '').split('\n').map(s => s.trim()).filter(Boolean);
        const workContents = (row['作業内容（管理者日報）'] || row['作業内容(管理者日報)'] || '').split('\n').map(s => s.trim());
        const overtimeTypes = (row['残業種別（管理者日報）'] || row['残業種別(管理者日報)'] || '').split('\n').map(s => s.trim());

        // G列: 残業時間 (17:30以降)
        const overtimeG = parseTimeToHours(row['残業時間'] || '');
        // L列: 早出時間 (08:00以前)
        const earlyL = parseTimeToHours(row['早出時間'] || '');

        // 残業合計 = G + L
        const totalOvertime = overtimeG + earlyL;

        // 各時間帯から定時/残業の現場時間を算出
        let regularFieldHours = 0;
        let regularTotalHours = 0;
        let overtimeFieldHours = 0;

        for (let i = 0; i < workTimes.length; i++) {
            const timeRange = workTimes[i];
            const content = workContents[i] || '';
            const otType = overtimeTypes[i] || '';

            // 時間帯をパース (例: "07:00～15:00")
            const { startMin, endMin, durationHours } = parseTimeRange(timeRange);
            if (durationHours <= 0) continue;

            // 定時範囲(08:00-17:30)との重なりを計算
            const regularOverlapStart = Math.max(startMin, REGULAR_START);
            const regularOverlapEnd = Math.min(endMin, REGULAR_END);
            const regularMinutes = Math.max(0, regularOverlapEnd - regularOverlapStart);
            const regularHoursInRange = regularMinutes / 60;

            // 残業時間 (08:00以前 + 17:30以降)
            const earlyMinutes = Math.max(0, Math.min(endMin, REGULAR_START) - startMin);
            const lateMinutes = Math.max(0, endMin - Math.max(startMin, REGULAR_END));
            const overtimeHoursInRange = (earlyMinutes + lateMinutes) / 60;

            // 定時内分の集計
            if (regularHoursInRange > 0) {
                regularTotalHours += regularHoursInRange;

                // 現場判定（定時内）
                if (FIELD_KEYWORDS_REGULAR.some(kw => content.includes(kw))) {
                    regularFieldHours += regularHoursInRange;
                }
            }

            // 残業分の集計（現場判定）
            if (overtimeHoursInRange > 0) {
                if (FIELD_KEYWORDS_OVERTIME.some(kw => otType.includes(kw))) {
                    overtimeFieldHours += overtimeHoursInRange;
                }
            }
        }

        // 集計
        emp.regularTotal = (emp.regularTotal || 0) + regularTotalHours;
        emp.regularField = (emp.regularField || 0) + regularFieldHours;
        emp.overtimeTotal = (emp.overtimeTotal || 0) + totalOvertime;
        emp.overtimeField = (emp.overtimeField || 0) + overtimeFieldHours;
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
