const { Redis } = require('@upstash/redis');
const { Client } = require('@line/bot-sdk');
const { v4: uuidv4 } = require('uuid');

// Upstash Redis client
const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// LINE Botクライアント設定（オプショナル）
let client = null;
if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
    client = new Client({
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        channelSecret: process.env.LINE_CHANNEL_SECRET
    });
}

module.exports = async (req, res) => {
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
        const { date, category, reports, employees, hours } = req.body;

        // バリデーション
        if (!date || !category) {
            return res.status(400).json({ error: '日付とカテゴリーを入力してください' });
        }

        // 新形式と旧形式の両方に対応
        let reportsToSubmit = [];

        if (reports && Array.isArray(reports)) {
            // 新形式: 個別時間
            reportsToSubmit = reports;
        } else if (employees && Array.isArray(employees) && hours) {
            // 旧形式: 全員同じ時間（後方互換性）
            reportsToSubmit = employees.map(emp => ({
                employee: emp,
                hours: parseFloat(hours)
            }));
        } else {
            return res.status(400).json({ error: '従業員と時間を入力してください' });
        }

        if (reportsToSubmit.length === 0) {
            return res.status(400).json({ error: '少なくとも1人の従業員を選択してください' });
        }

        const now = new Date().toISOString();
        const savedReports = [];

        // 各従業員ごとに個別のレポートを作成
        for (const report of reportsToSubmit) {
            const reportId = uuidv4();

            const reportData = {
                id: reportId,
                date,
                employees: [report.employee], // 1人ずつ保存
                category,
                hours: parseFloat(report.hours),
                created_at: now,
                updated_at: now
            };

            // Vercel KVに保存
            await kv.set(`report:${reportId}`, JSON.stringify(reportData));

            // 月別インデックスに追加
            const monthKey = date.substring(0, 7); // YYYY-MM
            const monthReportsKey = `reports:${monthKey}`;
            await kv.sadd(monthReportsKey, reportId);

            savedReports.push(reportData);
        }

        // LINE通知を送信（まとめて）
        try {
            await sendLineNotification(date, category, reportsToSubmit, now);
        } catch (lineError) {
            console.error('LINE notification error:', lineError);
            // LINE通知エラーでも報告は保存されているので続行
        }

        return res.status(200).json({
            success: true,
            reportCount: savedReports.length,
            message: `${savedReports.length}件の報告を送信しました`
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
};

// LINE通知送信
async function sendLineNotification(date, category, reports, createdAt) {
    if (!client) {
        console.log('LINE Bot not configured, skipping notification');
        return;
    }

    // グループIDの確認
    const groupId = process.env.LINE_GROUP_ID;
    if (!groupId) {
        console.log('LINE_GROUP_ID not set, skipping notification');
        return;
    }

    // 各従業員と時間のリスト作成
    const employeeList = reports.map(r => `  • ${r.employee}: ${r.hours}時間`).join('\n');
    const totalHours = reports.reduce((sum, r) => sum + parseFloat(r.hours), 0).toFixed(1);

    const message = `📝 残業報告が届きました\n\n` +
        `📅 日付: ${date}\n` +
        `⏰ カテゴリ: ${category}\n\n` +
        `👥 報告者:\n${employeeList}\n\n` +
        `合計: ${totalHours}時間\n\n` +
        `報告時刻: ${new Date(createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;

    // 特定のグループに送信
    try {
        await client.pushMessage(groupId, {
            type: 'text',
            text: message
        });
        console.log('LINE notification sent to group:', groupId);
    } catch (error) {
        console.error('Failed to send LINE notification:', error);
    }
}
