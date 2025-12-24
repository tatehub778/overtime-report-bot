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
        const { month, force_refresh } = req.body;

        if (!month) {
            return res.status(400).json({
                error: 'Month is required',
                details: 'Please provide month in YYYY-MM format'
            });
        }

        // 強制再検証でない場合、キャッシュをチェック
        if (!force_refresh) {
            const cachedResult = await kv.get(`verification_result:${month}`);
            if (cachedResult) {
                console.log('Returning cached verification result for', month);
                return res.status(200).json({
                    success: true,
                    verification: cachedResult,
                    from_cache: true
                });
            }
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

        // 従業員マスタを取得（表示順のため）
        const employeesRef = await getEmployeesMap();

        console.log('=== DEBUG: System Reports ===');
        console.log('Total system reports:', systemReports.length);
        if (systemReports.length > 0) {
            console.log('Sample report:', JSON.stringify(systemReports[0], null, 2));
        }

        // 突合を実行
        const verification = performVerification(cboData.records, systemReports, month, employeesRef);

        // デバッグ情報を追加
        verification.debug = {
            total_system_reports: systemReports.length,
            sample_system_report: systemReports.length > 0 ? systemReports[0] : null,
            sample_system_report_2: systemReports.length > 1 ? systemReports[1] : null
        };

        // 検証結果をキャッシュに保存
        await kv.set(`verification_result:${month}`, verification);
        console.log('Verification result cached for', month);

        return res.status(200).json({
            success: true,
            verification,
            from_cache: false
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
 * 従業員マスタを取得してマップ化
 */
async function getEmployeesMap() {
    const employeeIds = await kv.smembers('employees:all') || [];
    const employees = [];

    for (const id of employeeIds) {
        const data = await kv.get(`employee:${id}`);
        if (data) {
            employees.push(typeof data === 'string' ? JSON.parse(data) : data);
        }
    }

    // display_orderでソート
    employees.sort((a, b) => {
        if (a.display_order !== undefined && b.display_order !== undefined) {
            return a.display_order - b.display_order;
        }
        return a.name.localeCompare(b.name, 'ja');
    });

    // 名前 → メタデータ（順序、所属）のマップ
    return {
        list: employees.map(e => normalizeEmployeeName(e.cboName)),
        map: new Map(employees.map((e, index) => [
            normalizeEmployeeName(e.cboName),
            {
                index,
                department: e.department || 'unknown',
                active: e.active !== false
            }
        ]))
    };
}

/**
 * 突合を実行
 */
function performVerification(cboRecords, systemReports, month, employeesRef) {
    // CBOレコードを従業員名+日付でマップ化
    const cboMap = new Map();
    for (const record of cboRecords) {
        const key = `${record.employee}|${record.date}`;
        cboMap.set(key, record);
    }

    // システム報告を従業員名+日付でマップ化
    const systemMap = new Map();

    console.log('=== DEBUG: Building System Map ===');
    console.log('Total reports to process:', systemReports.length);

    for (const report of systemReports) {
        console.log('Processing report:', {
            id: report.id,
            date: report.date,
            employees: report.employees,
            category: report.category,
            hours: report.hours
        });

        // 各従業員について（通常は1人）
        for (const employee of report.employees) {
            const key = `${employee}|${formatDateFromReport(report.date)}`;

            const categoryInfo = {
                id: report.id,
                category: report.category,
                hours: report.hours
            };

            if (systemMap.has(key)) {
                // 同じ日に複数報告がある場合は合計
                const existing = systemMap.get(key);
                existing.hours += report.hours;
                existing.categories = existing.categories || [];
                existing.categories.push(categoryInfo);
                console.log(`  → Adding to existing: ${employee} on ${formatDateFromReport(report.date)}, new total: ${existing.hours}h`);
            } else {
                systemMap.set(key, {
                    employee,
                    date: formatDateFromReport(report.date),
                    hours: report.hours,
                    category: report.category,
                    categories: [categoryInfo]
                });
                console.log(`  → New entry: ${employee} on ${formatDateFromReport(report.date)}, ${report.hours}h`);
            }
        }
    }

    console.log('=== DEBUG: System Map Complete ===');
    console.log('System map size:', systemMap.size);
    const firstFew = Array.from(systemMap.entries()).slice(0, 5);
    console.log('Sample system map entries:', JSON.stringify(firstFew, null, 2));

    // 差異を検出
    const missing = [];      // CBOにあるがシステムにない
    const excess = [];       // システムにあるがCBOにない
    const discrepancies = []; // 両方にあるが時間が違う
    const matches = [];      // 一致

    const TOLERANCE = 0; // 許容誤差（時間）

    // CBOレコードをチェック
    for (const [key, cboRecord] of cboMap) {
        // 登録済みの社員かチェック（登録外は無視）
        const normalizedName = normalizeEmployeeName(cboRecord.employee);
        const employeeMeta = employeesRef.map.get(normalizedName);

        // マスタにない、または退職者（非アクティブ）は無視
        if (!employeeMeta || !employeeMeta.active) {
            // console.log(`Skipping unregistered/inactive employee: ${cboRecord.employee}`);
            continue;
        }

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
                    difference: parseFloat((cboRecord.total - systemRecord.hours).toFixed(2)),
                    system_details: systemRecord.categories
                });
            } else {
                matches.push({
                    date: cboRecord.date,
                    employee: cboRecord.employee,
                    hours: cboRecord.total,
                    system_details: systemRecord.categories
                });
            }

            // 処理済みとしてマークするため削除
            systemMap.delete(key);
        }
    }

    // システムに残っているものは過剰報告
    for (const [key, systemRecord] of systemMap) {
        // 登録済みの社員かチェック（登録外は無視）
        const normalizedName = normalizeEmployeeName(systemRecord.employee);
        const employeeMeta = employeesRef.map.get(normalizedName);

        // マスタにない、または退職者（非アクティブ）は無視
        if (!employeeMeta || !employeeMeta.active) {
            continue;
        }

        excess.push({
            date: systemRecord.date,
            employee: systemRecord.employee,
            cbo_hours: 0,
            system_hours: systemRecord.hours,
            category: systemRecord.category,
            system_details: systemRecord.categories
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

    // 従業員ごとにグループ化
    const byEmployee = groupByEmployee(missing, excess, discrepancies, matches, cboRecords, employeesRef);

    // 未入力日を検出
    const missingDaysInfo = detectMissingDays(month, cboRecords, employeesRef);

    return {
        month,
        verified_at: new Date().toISOString(),
        summary,
        details: {
            missing: missing.sort((a, b) => a.date.localeCompare(b.date)),
            excess: excess.sort((a, b) => a.date.localeCompare(b.date)),
            discrepancies: discrepancies.sort((a, b) => a.date.localeCompare(b.date)),
            matches: matches.sort((a, b) => a.date.localeCompare(b.date))
        },
        by_employee: byEmployee,
        missing_days: missingDaysInfo
    };
}

/**
 * 従業員ごとにデータをグループ化
 */
/**
 * 従業員ごとにデータをグループ化
 */
function groupByEmployee(missing, excess, discrepancies, matches, cboRecords, employeesRef) {
    const employeeMap = new Map();
    const encounteredEmployees = new Set();

    // 全データの従業員を収集
    [...missing, ...excess, ...discrepancies, ...matches].forEach(item => {
        encounteredEmployees.add(item.employee);
    });
    cboRecords.forEach(r => encounteredEmployees.add(r.employee));

    // ソート順を決定
    const sortedEmployees = Array.from(encounteredEmployees).sort((a, b) => {
        // メタデータを取得
        const metaA = employeesRef && employeesRef.map.has(a) ? employeesRef.map.get(a) : { index: 9999, department: 'unknown' };
        const metaB = employeesRef && employeesRef.map.has(b) ? employeesRef.map.get(b) : { index: 9999, department: 'unknown' };

        // Debug log (first 5 comparisons only to avoid spam)
        if (Math.random() < 0.05) {
            console.log(`Comparing ${a} vs ${b}:`,
                `Dept: ${metaA.department}(${metaA.index}) vs ${metaB.department}(${metaB.index})`);
        }

        // 1. 所属でソート (factory -> management -> others)
        const deptOrder = { 'factory': 1, 'management': 2, 'unknown': 3 };
        const deptA = deptOrder[metaA.department] || 3;
        const deptB = deptOrder[metaB.department] || 3;

        if (deptA !== deptB) {
            return deptA - deptB;
        }

        // 2. その中での順序（display_order）
        if (metaA.index !== metaB.index) {
            return metaA.index - metaB.index;
        }

        // 3. 最後は名前順
        return a.localeCompare(b, 'ja');
    });

    // 各カテゴリのデータを従業員ごとに振り分け
    [...missing, ...excess, ...discrepancies, ...matches].forEach(item => {
        if (!employeeMap.has(item.employee)) {
            employeeMap.set(item.employee, []);
        }

        let status = 'match';
        let icon = '✅';
        if (missing.includes(item)) {
            status = 'missing';
            icon = '⚠️';
        } else if (excess.includes(item)) {
            status = 'excess';
            icon = '❌';
        } else if (discrepancies.includes(item)) {
            status = 'discrepancy';
            icon = '🔄';
        }

        employeeMap.get(item.employee).push({
            date: item.date,
            status,
            icon,
            cbo_hours: item.cbo_hours !== undefined ? item.cbo_hours : item.hours,
            system_hours: item.system_hours !== undefined ? item.system_hours : item.hours,
            difference: item.difference || 0,
            category: item.category || '',
            system_details: item.system_details || [],
            // チェック状態（既存データがあればそれを使用、なければfalse）
            self_checked: item.self_checked || false,
            admin_checked: item.admin_checked || false,
            self_checked_at: item.self_checked_at || null,
            admin_checked_at: item.admin_checked_at || null
        });
    });

    // 従業員ごとにソート（日付順）
    const result = [];
    sortedEmployees.forEach(employee => {
        if (employeeMap.has(employee)) {
            const records = employeeMap.get(employee).sort((a, b) => a.date.localeCompare(b.date));
            result.push({
                employee,
                records,
                total_records: records.length,
                matches: records.filter(r => r.status === 'match').length,
                issues: records.filter(r => r.status !== 'match').length
            });
        }
    });

    return result;
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
 * 従業員名を正規化（番号を除去、空白を正規化）
 * 例: "田中 祐太 023" → "田中 祐太"
 */
function normalizeEmployeeName(name) {
    if (!name) return '';
    // 末尾の番号を除去（3桁の数字）
    let normalized = name.replace(/\s+\d{3}$/, '');
    // 全角スペースを半角に統一
    normalized = normalized.replace(/　/g, ' ');
    // 連続する空白を1つに
    normalized = normalized.replace(/\s+/g, ' ');
    return normalized.trim();
}
/**
 * システムの日付形式 (YYYY-MM-DD) を CBO形式 (YYYY/MM/DD) に変換
 */
function formatDateFromReport(dateStr) {
    if (!dateStr) return '';
    // YYYY-MM-DD → YYYY/MM/DD
    return dateStr.replace(/-/g, '/');
}

/**
 * 未入力日を検出する
 * @param {string} month - 対象月 (YYYY-MM)
 * @param {Array} cboRecords - CBOレコード
 * @param {Object} employeesRef - 従業員マスタ
 * @returns {Object} 未入力日の情報
 */
function detectMissingDays(month, cboRecords, employeesRef) {
    // 1. 対象月の全日付を生成
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const allDates = [];

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}/${String(monthNum).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
        allDates.push(dateStr);
    }

    // 2. アクティブな従業員数を取得
    const activeEmployees = employeesRef.list.filter(name => {
        const meta = employeesRef.map.get(name);
        return meta && meta.active;
    });
    const activeEmployeeCount = activeEmployees.length;

    // 3. 各日付の記録人数をカウント（従業員名を正規化）
    const dateRecordCounts = new Map();
    const dateRecordedEmployees = new Map();

    for (const record of cboRecords) {
        const normalizedName = normalizeEmployeeName(record.employee);
        const meta = employeesRef.map.get(normalizedName);

        // アクティブな従業員のみカウント
        if (meta && meta.active) {
            const count = dateRecordCounts.get(record.date) || 0;
            dateRecordCounts.set(record.date, count + 1);

            // この日に記録した従業員を記録
            if (!dateRecordedEmployees.has(record.date)) {
                dateRecordedEmployees.set(record.date, new Set());
            }
            dateRecordedEmployees.get(record.date).add(normalizedName);
        }
    }

    // 4. 未入力日を検出（休日を除外）
    const missingDays = [];
    const holidays = [];
    const threshold = 5; // 5人以上記録があれば出勤日

    for (const dateStr of allDates) {
        const recordCount = dateRecordCounts.get(dateStr) || 0;
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay(); // 0=日, 6=土

        // 休日判定: 5人未満の記録しかない日は休日とみなす
        if (recordCount < threshold) {
            holidays.push({
                date: dateStr,
                recordCount,
                dayOfWeek,
                reason: recordCount === 0 ? '全員未記録' : `${recordCount}人のみ記録`
            });
        } else {
            // 出勤日だが、全員記録しているわけではない場合
            const missingCount = activeEmployeeCount - recordCount;
            if (missingCount > 0) {
                missingDays.push({
                    date: dateStr,
                    recordCount,
                    missingCount,
                    dayOfWeek
                });
            }
        }
    }

    return {
        totalDays: allDates.length,
        workDays: allDates.length - holidays.length,
        holidays: holidays.length,
        missingDays: missingDays.sort((a, b) => a.date.localeCompare(b.date)),
        holidayDetails: holidays.sort((a, b) => a.date.localeCompare(b.date)),
        activeEmployeeCount,
        threshold
    };
}

