const { kv } = require('@vercel/kv');
const { parse } = require('csv-parse/sync');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { cboCsv, attendanceCsv } = req.body;

        if (!cboCsv || !attendanceCsv) {
            return res.status(400).json({ error: '両方のCSVファイルが必要です' });
        }

        // 1. 管理メンバー情報の取得
        const managementMembers = await getManagementMembers();

        // 2. データのパースと集計
        const cboData = parseCboCsv(cboCsv, managementMembers);
        const attendanceData = parseAttendanceCsv(attendanceCsv, managementMembers);

        // 3. データの結合
        const summary = combineData(cboData, attendanceData, managementMembers);

        return res.status(200).json({ summary });

    } catch (error) {
        console.error('Analysis error:', error);
        return res.status(500).json({ error: '分析中にエラーが発生しました', details: error.message });
    }
};

// 管理メンバーの取得
async function getManagementMembers() {
    const members = new Map(); // Normalized Name -> Member Object

    try {
        const ids = await kv.smembers('employees:all');
        if (!ids) return members;

        for (const id of ids) {
            const data = await kv.get(`employee:${id}`);
            if (data && (data.department === 'management')) {
                // 名前を正規化してキーにする（スペース除去など）
                const normName = normalizeName(data.name);
                members.set(normName, {
                    ...data,
                    normName
                });
                // CBO名でも引けるようにする
                if (data.cboName) {
                    members.set(normalizeName(data.cboName), {
                        ...data,
                        normName
                    });
                }
            }
        }
    } catch (e) {
        console.error('Failed to fetch members:', e);
    }
    return members;
}

// CBO CSV (現場時間・事務残業) のパース
function parseCboCsv(csvContent, members) {
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
        records = [];
    }

    const result = new Map(); // Name -> Stats

    for (const row of records) {
        const rawName = row['報告者'] || row['ユーザー名'] || '';
        const normName = normalizeName(rawName);

        // 管理メンバーでなければスキップ
        if (!members.has(normName)) continue;
        const member = members.get(normName);

        if (!result.has(member.id)) {
            result.set(member.id, {
                id: member.id,
                name: member.name,
                fieldWorkRegular: 0, // 定時内現場
                officeOvertime: 0,   // 事務残業
                details: []
            });
        }
        const stats = result.get(member.id);

        const projectNames = (row['案件名'] || '').split('\n');

        const timeRanges = (row['作業時間'] || '').split('\n');
        const contentTypes = (row['作業内容'] || '').split('\n');
        const overtimeTypes = (row['残業種別'] || '').split('\n');
        const overtimes = (row['残業時間'] || '').split('\n');
        const earlies = (row['早出時間'] || '').split('\n');

        // 最大の行数を取得
        const maxLines = Math.max(timeRanges.length, contentTypes.length, overtimeTypes.length);

        for (let i = 0; i < maxLines; i++) {
            const range = timeRanges[i] || '';
            const content = contentTypes[i] || '';
            const otType = overtimeTypes[i] || '';
            const otStr = overtimes[i] || '0:00';
            const earlyStr = earlies[i] || '0:00';

            // 時間計算
            const totalDuration = calculateDuration(range); // 時間帯から算出
            const otHours = parseTimeStr(otStr);
            const earlyHours = parseTimeStr(earlyStr);

            let regularHours = Math.max(0, totalDuration - otHours - earlyHours);

            const isOfficeOvertime = otType.includes('事務残業');
            const isOfficeContent = /事務|見積|作図|打合せ|会議|移動/.test(content);
            const isFieldContent = /現場|工事|作業|立会|搬入/.test(content);

            // 分類
            if (isOfficeOvertime) {
                stats.officeOvertime += otHours + earlyHours;

                // 詳細リストに追加 (事務残業のみ)
                stats.details.push({
                    date: row['作業日'] || '',
                    project: (projectNames[i] || projectNames[0] || '').trim(), // 行対応がなければ先頭を使う
                    task: content,
                    hours: otHours + earlyHours
                });
            }

            // 定時内分の判定
            if (regularHours > 0) {
                if (isFieldContent || (!isOfficeContent)) {
                    // 明示的に現場、または事務っぽくないもの
                    stats.fieldWorkRegular += regularHours;
                }
            }
        }
    }
    return result;
}

// 出勤簿 CSV (残業合計) のパース
function parseAttendanceCsv(csvContent, members) {
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
        records = [];
    }

    const result = new Map(); // Name -> Total Overtime

    for (const row of records) {
        const rawName = row['報告者'] || '';
        const normName = normalizeName(rawName);

        if (!members.has(normName)) continue;
        const member = members.get(normName);

        // 残業(h) カラムを使用
        const totalOt = parseFloat(row['残業(h)'] || 0);

        if (!isNaN(totalOt)) {
            const current = result.get(member.id) || 0;
            result.set(member.id, current + totalOt);
        }
    }
    return result;
}

// データ結合
function combineData(cboData, attendanceData, members) {
    const combined = [];
    const seenIds = new Set();

    // 1. CBOデータから
    cboData.forEach((stats, id) => {
        seenIds.add(id);
        const totalOvertime = attendanceData.get(id) || 0;

        let otherOvertime = Math.max(0, totalOvertime - stats.officeOvertime);

        combined.push({
            name: stats.name,
            fieldWorkRegular: parseFloat(stats.fieldWorkRegular.toFixed(2)),
            officeOvertime: parseFloat(stats.officeOvertime.toFixed(2)),
            totalOvertime: parseFloat(totalOvertime.toFixed(2)),
            otherOvertime: parseFloat(otherOvertime.toFixed(2)),
            details: stats.details || []
        });
    });

    // 2. データがなかったメンバーも追加
    members.forEach((m) => {
        if (!seenIds.has(m.id)) {
            if ([...seenIds].includes(m.id)) return;
            seenIds.add(m.id);

            combined.push({
                name: m.name,
                fieldWorkRegular: 0,
                officeOvertime: 0,
                totalOvertime: 0,
                otherOvertime: 0,
                details: []
            });
        }
    });

    return combined;
}

// ユーティリティ: 名前正規化
function normalizeName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/\d+/g, '').replace(/[\s　]+/g, '').trim();
}

// ユーティリティ: 時間パース (HH:MM -> Hours)
function parseTimeStr(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    if (isNaN(h)) return 0;
    return h + (m || 0) / 60;
}

// ユーティリティ: 期間計算 (HH:MM～HH:MM -> Hours)
function calculateDuration(rangeStr) {
    if (!rangeStr || !rangeStr.includes('～')) return 0;
    const [start, end] = rangeStr.split('～');

    let startH = parseTimeStr(start);
    let endH = parseTimeStr(end);

    if (endH < startH) {
        endH += 24;
    }

    return endH - startH;
}
