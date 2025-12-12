import { kv } from '@vercel/kv';

/**
 * CBO CSVをパースしてVercel KVに保存するAPI
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
        const { csvData, month } = req.body;

        if (!csvData || !month) {
            return res.status(400).json({
                error: 'CSV data and month are required',
                details: 'Please provide csvData (string) and month (YYYY-MM format)'
            });
        }

        // CSVをパース
        const records = parseCSV(csvData);

        if (records.length === 0) {
            return res.status(400).json({
                error: 'No valid records found in CSV',
                details: 'The CSV file appears to be empty or contains no valid data'
            });
        }

        // Vercel KVに保存
        const kvKey = `cbo_data:${month}`;
        const data = {
            month,
            uploaded_at: new Date().toISOString(),
            records
        };

        await kv.set(kvKey, data);

        // 統計情報を返す
        const dates = records.map(r => new Date(r.date));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));

        const stats = {
            total_records: records.length,
            employees: [...new Set(records.map(r => r.employee))].length,
            date_range: {
                start: formatDate(minDate),
                end: formatDate(maxDate)
            },
            total_hours: records.reduce((sum, r) => sum + r.total, 0).toFixed(1)
        };

        return res.status(200).json({
            success: true,
            message: 'CSV parsed and saved successfully',
            stats
        });

    } catch (error) {
        console.error('Error parsing CSV:', error);
        return res.status(500).json({
            error: 'Failed to parse CSV',
            details: error.message
        });
    }
}

/**
 * CSV文字列をパースして構造化データに変換
 */
function parseCSV(csvData) {
    const lines = csvData.trim().split('\n');

    if (lines.length < 2) {
        throw new Error('CSV must contain at least a header row and one data row');
    }

    // ヘッダー行をスキップ（1行目）
    const dataLines = lines.slice(1);

    const records = [];

    for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i].trim();
        if (!line) continue;

        try {
            const record = parseLine(line, i + 2); // +2 because header is line 1
            if (record) {
                records.push(record);
            }
        } catch (error) {
            console.warn(`Skipping line ${i + 2}: ${error.message}`);
            // エラーがあっても続行（部分的なデータでも保存）
        }
    }

    return records;
}

/**
 * CSV1行をパース
 * フォーマット: 日付,曜日,報告者,開始時刻,終了時刻,作業(h)_所定,作業(h)_時間外,残業(h),早出(h),休出(h),...
 */
function parseLine(line, lineNumber) {
    const columns = line.split(',');

    if (columns.length < 9) {
        throw new Error(`Invalid column count: expected at least 9, got ${columns.length}`);
    }

    const date = columns[0].trim();
    const employeeRaw = columns[2].trim();
    const regularWorkStr = columns[5].trim(); // 作業(h)_所定
    const overtimeStr = columns[7].trim();
    const earlyStr = columns[8].trim();
    const holidayStr = columns[9].trim();

    // 空の報告者名はスキップ
    if (!employeeRaw || employeeRaw === '-') {
        return null;
    }

    // 日付チェック（YYYY/MM/DD形式）
    if (!date.match(/^\d{4}\/\d{1,2}\/\d{1,2}$/)) {
        throw new Error(`Invalid date format: ${date}`);
    }

    // 従業員名を正規化（番号を除去）
    const employee = normalizeEmployeeName(employeeRaw);

    // 時間をパース（"-" は 0 として扱う）
    const regularWork = parseHours(regularWorkStr);
    const overtime = parseHours(overtimeStr);
    const early = parseHours(earlyStr);
    const holiday = parseHours(holidayStr);

    // システム報告では、残業(h) + 早出(h) + 休出(h) の合計で報告される
    // CBOのデータもこれに合わせて計算
    const total = overtime + early + holiday;

    // 時間が全て0の場合はスキップ
    if (total === 0) {
        return null;
    }

    return {
        date,
        employee,
        overtime,
        early,
        holiday,
        regular_work: regularWork,
        total: parseFloat(total.toFixed(2))
    };
}

/**
 * 従業員名を正規化（番号を除去、空白を正規化）
 * 例: "田中 祐太 023" → "田中 祐太"
 */
function normalizeEmployeeName(name) {
    // 末尾の番号を除去（3桁の数字）
    let normalized = name.replace(/\s+\d{3}$/, '');

    // 全角スペースを半角に統一
    normalized = normalized.replace(/　/g, ' ');

    // 連続する空白を1つに
    normalized = normalized.replace(/\s+/g, ' ');

    return normalized.trim();
}

/**
 * 時間文字列をパース
 * "-" は 0、数値はそのまま
 */
function parseHours(hoursStr) {
    if (!hoursStr || hoursStr === '-') {
        return 0;
    }

    const hours = parseFloat(hoursStr);

    if (isNaN(hours)) {
        return 0;
    }

    return hours;
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
