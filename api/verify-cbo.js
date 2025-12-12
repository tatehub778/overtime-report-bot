import { kv } from '@vercel/kv';

/**
 * CBO データとシステム報告を突合するAPI
 */
export default async function handler(req, res) {
    // CORSヘッダー
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { month } = req.body;

        if (!month) {
            return res.status(400).json({
                error: 'Month is required',
                details: 'Please provide month in YYYY-MM format'
            });
        }

        // CBOデータを取得
        const cboData = await kv.get(`cbo_data:${month}`);

        if (!cboData) {
            return res.status(404).json({
                error: 'CBO data not found',
                details: `No CBO data uploaded for ${month}. Please upload CSV first.`
            });
        }

        // システムの残業報告を取得
        const systemReports = await getSystemReports(month);

        console.log('=== DEBUG: System Reports ===');
        console.log('Total system reports:', systemReports.length);
        if (systemReports.length > 0) {
            console.log('Sample report:', JSON.stringify(systemReports[0], null, 2));
        }

        // 突合を実行
        const verification = performVerification(cboData.records, systemReports, month);

        return res.status(200).json({
            success: true,
            verification
        });

    } catch (error) {
        console.error('Error verifying CBO data:', error);
        return res.status(500).json({
            error: 'Failed to verify CBO data',
            details: error.message
        });
    }
}

/**
 * 指定月のシステム報告を取得
 */
async function getSystemReports(month) {
    const reports = [];

    // 月別インデックスから取得
    const monthReportsKey = `reports:${month}`;
    const reportIds = await kv.smembers(monthReportsKey);

    if (!reportIds || reportIds.length === 0) {
        return [];
    }

    // 各レポートを取得
    for (const reportId of reportIds) {
        const reportData = await kv.get(`report:${reportId}`);
        if (reportData) {
            const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
            reports.push(report);
        }
    }

    return reports;
}

/**
 * 突合を実行
 */
function performVerification(cboRecords, systemReports, month) {
    // CBOレコードを従業員名+日付でマップ化
    const cboMap = new Map();
    for (const record of cboRecords) {
        const key = `${record.employee}|${record.date}`;
        cboMap.set(key, record);
    }

    // システム報告を従業員名+日付でマップ化
    const systemMap = new Map();
    for (const report of systemReports) {
        // 各従業員について
        for (const employee of report.employees) {
            const key = `${employee}|${formatDateFromReport(report.date)}`;

            if (systemMap.has(key)) {
                // 同じ日に複数報告がある場合は合計
                systemMap.get(key).hours += report.hours;
            } else {
                systemMap.set(key, {
                    employee,
                    date: formatDateFromReport(report.date),
                    hours: report.hours,
                    category: report.category
                });
            }
        }
    }

    console.log('=== DEBUG: System Map ===');
    console.log('System map size:', systemMap.size);
    const firstFew = Array.from(systemMap.entries()).slice(0, 3);
    console.log('Sample system map entries:', JSON.stringify(firstFew, null, 2));

    // 差異を検出
    const missing = [];      // CBOにあるがシステムにない
    const excess = [];       // システムにあるがCBOにない
    const discrepancies = []; // 両方にあるが時間が違う
    const matches = [];      // 一致

    const TOLERANCE = 0.5; // 許容誤差（時間）

    // CBOレコードをチェック
    for (const [key, cboRecord] of cboMap) {
        const systemRecord = systemMap.get(key);

        if (!systemRecord) {
            // システムに報告なし
            missing.push({
                date: cboRecord.date,
                employee: cboRecord.employee,
                cbo_hours: cboRecord.total,
                system_hours: 0
            });
        } else {
            // 両方にある場合、時間を比較
            const diff = Math.abs(cboRecord.total - systemRecord.hours);

            if (diff > TOLERANCE) {
                discrepancies.push({
                    date: cboRecord.date,
                    employee: cboRecord.employee,
                    cbo_hours: cboRecord.total,
                    system_hours: systemRecord.hours,
                    difference: parseFloat((cboRecord.total - systemRecord.hours).toFixed(2))
                });
            } else {
                matches.push({
                    date: cboRecord.date,
                    employee: cboRecord.employee,
                    hours: cboRecord.total
                });
            }

            // 処理済みとしてマークするため削除
            systemMap.delete(key);
        }
    }

    // システムに残っているものは過剰報告
    for (const [key, systemRecord] of systemMap) {
        excess.push({
            date: systemRecord.date,
            employee: systemRecord.employee,
            cbo_hours: 0,
            system_hours: systemRecord.hours,
            category: systemRecord.category
        });
    }

    // サマリーを作成
    const summary = {
        total_cbo_records: cboRecords.length,
        total_system_reports: systemReports.reduce((sum, r) => sum + r.employees.length, 0),
        matches: matches.length,
        missing_reports: missing.length,
        excess_reports: excess.length,
        time_discrepancies: discrepancies.length
    };

    return {
        month,
        verified_at: new Date().toISOString(),
        summary,
        details: {
            missing: missing.sort((a, b) => a.date.localeCompare(b.date)),
            excess: excess.sort((a, b) => a.date.localeCompare(b.date)),
            discrepancies: discrepancies.sort((a, b) => a.date.localeCompare(b.date)),
            matches: matches.sort((a, b) => a.date.localeCompare(b.date))
        }
    };
}

/**
 * Date オブジェクトを YYYY/MM/DD 形式にフォーマット
 */
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
}

/**
 * システムの日付形式 (YYYY-MM-DD) を CBO形式 (YYYY/MM/DD) に変換
 */
function formatDateFromReport(dateStr) {
    if (!dateStr) return '';
    // YYYY-MM-DD → YYYY/MM/DD
    return dateStr.replace(/-/g, '/');
}
