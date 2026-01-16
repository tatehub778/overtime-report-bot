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
            officeDetails: [],
            cboDetails: [],
            attendanceMap: new Map()
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

        // 4. 休日出勤のみのデータをcboDetailsに追加
        // (CBO日報処理でスキップされた、またはCBO日報にない休日出勤データ)
        if (results.attendanceMap) {
            for (const [key, info] of results.attendanceMap.entries()) {
                if (info.isHolidayWork && info.holidayWorkHours > 0) {
                    const [dateStr, name] = key.split('_');
                    results.cboDetails.push({
                        date: dateStr,
                        name: name,
                        regularTotal: 0,
                        regularField: 0,
                        overtimeTotal: 0,
                        overtimeField: 0,
                        holidayWorkHours: info.holidayWorkHours
                    });
                }
            }
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
            taskCategories: emp.taskCategories || {},
            // 休日出勤
            holidayWorkHours: round(emp.holidayWorkHours || 0)
        }));

        return res.status(200).json({
            summary,
            officeDetails: results.officeDetails,
            cboDetails: results.cboDetails
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
        let overtimeFieldHours = 0;
        let overtimeTotalHours = 0; // すべてE列から計算した残業時間の合計

        // K列のインデックス追跡用
        let otTypeIndex = 0;

        for (let i = 0; i < workTimes.length; i++) {
            const timeRange = workTimes[i];
            const content = workContents[i] || '';

            // 時間帯をパース
            const { startMin, endMin, durationHours } = parseTimeRange(timeRange);
            if (durationHours <= 0) continue;

            // 定時範囲との重なりを計算（半休考慮済み）
            const regularOverlapStart = Math.max(startMin, regularStart);
            const regularOverlapEnd = Math.min(endMin, regularEnd);
            const regularMinutes = Math.max(0, regularOverlapEnd - regularOverlapStart);
            const regularHoursInRange = regularMinutes / 60;

            // 残業時間 (定時開始前 + 定時終了後)
            const earlyMinutes = Math.max(0, Math.min(endMin, regularStart) - startMin);
            const lateMinutes = Math.max(0, endMin - Math.max(startMin, regularEnd));

            const earlyHoursInRange = earlyMinutes / 60;
            const lateHoursInRange = lateMinutes / 60;

            // 定時内分の集計（休憩時間を厳密に除外）
            if (regularHoursInRange > 0) {
                // 休憩時間帯（分単位）
                const breaks = [
                    { start: 10 * 60, end: 10 * 60 + 15 },      // 10:00-10:15
                    { start: 12 * 60, end: 13 * 60 },           // 12:00-13:00
                    { start: 15 * 60, end: 15 * 60 + 15 }       // 15:00-15:15
                ];

                let actualRegularMinutes = regularMinutes;

                // 各休憩時間との「またぎ」判定を行い、休憩を引く
                // 条件: 勤務開始 < 休憩開始 && 勤務終了 > 休憩終了
                // つまり、その休憩時間をフルに休めている場合のみ引く（途中出勤などは引かない）
                // または単純に「重なり」でもよいが、要望は「12:00開始なら12:00-13:00は休憩じゃない」
                // → 重複判定だが、「開始時刻が休憩終了時刻以降なら引かない」は自動的に満たされる
                // 問題は「12:00ちょうどに開始」の場合。
                // startMin < brk.start とすることで「またぎ」を表現する

                for (const brk of breaks) {
                    // 勤務時間が休憩時間を完全に内包（またいでいる）している場合のみ引く
                    if (startMin <= brk.start && endMin >= brk.end) {
                        const overlapStart = Math.max(regularOverlapStart, brk.start);
                        const overlapEnd = Math.min(regularOverlapEnd, brk.end);
                        if (overlapEnd > overlapStart) {
                            actualRegularMinutes -= (overlapEnd - overlapStart);
                        }
                    }
                }

                const actualRegularHours = Math.max(0, actualRegularMinutes) / 60;
                regularTotalHours += actualRegularHours;

                if (FIELD_KEYWORDS_REGULAR.some(kw => content.includes(kw))) {
                    regularFieldHours += actualRegularHours;
                }
            }

            // 早出残業（08:00以前）の集計
            if (earlyHoursInRange > 0) {
                overtimeTotalHours += earlyHoursInRange;
                if (FIELD_KEYWORDS_REGULAR.some(kw => content.includes(kw))) {
                    overtimeFieldHours += earlyHoursInRange;
                }
            }

            // 定時後残業（動的終了時刻以降）の集計
            if (lateHoursInRange > 0) {
                overtimeTotalHours += lateHoursInRange;

                const otType = overtimeTypes[otTypeIndex] || '';
                otTypeIndex++;

                if (FIELD_KEYWORDS_OVERTIME.some(kw => otType.includes(kw))) {
                    overtimeFieldHours += lateHoursInRange;
                }
            }
        }

        // 休憩控除ロジック（後処理）は廃止し、ループ内での厳密適用のみとする
        const finalRegularTotal = regularTotalHours;
        const finalRegularField = regularFieldHours;

        // 集計
        // 以前はG列(totalOvertime)を使っていたが、E列積算値(overtimeTotalHours)に変更
        // これにより、事務残業 = Total - Field が必ず0以上になる（マイナス撲滅）
        emp.regularTotal = (emp.regularTotal || 0) + finalRegularTotal;
        emp.regularField = (emp.regularField || 0) + finalRegularField;
        emp.overtimeTotal = (emp.overtimeTotal || 0) + overtimeTotalHours;
        emp.overtimeField = (emp.overtimeField || 0) + overtimeFieldHours;

        // 詳細データに追加
        results.cboDetails.push({
            date: normalizeDate(workDate),
            name: member.name,
            regularTotal: finalRegularTotal,
            regularField: finalRegularField,
            overtimeTotal: overtimeTotalHours,
            overtimeField: overtimeFieldHours,
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
