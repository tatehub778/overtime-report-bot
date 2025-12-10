const { kv } = require('@vercel/kv');
const { Client } = require('@line/bot-sdk');
const { v4: uuidv4 } = require('uuid');

// LINE Botクライアント設定
const client = new Client({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || ''
});

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
        const { date, employees, category, hours } = req.body;

        // バリデーション
        if (!date || !employees || !Array.isArray(employees) || employees.length === 0 || !category || !hours) {
            return res.status(400).json({ error: '必要な項目が不足しています' });
        }

        // レポートデータ作成
        const reportId = uuidv4();
        const now = new Date().toISOString();

        const report = {
            id: reportId,
            date,
            employees,
            category,
            hours: parseFloat(hours),
            created_at: now,
            updated_at: now
        };

        // Vercel KVに保存
        await kv.set(`report:${reportId}`, JSON.stringify(report));

        // 月別インデックスに追加
        const monthKey = date.substring(0, 7); // YYYY-MM
        const monthReportsKey = `reports:${monthKey}`;
        await kv.sadd(monthReportsKey, reportId);

        // LINE通知を送信
        try {
            await sendLineNotification(report);
        } catch (lineError) {
            console.error('LINE notification error:', lineError);
            // LINE通知エラーでも報告は保存されているので続行
        }

        return res.status(200).json({
            success: true,
            reportId,
            message: '報告を送信しました'
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
};

// LINE通知送信
async function sendLineNotification(report) {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        console.log('LINE_CHANNEL_ACCESS_TOKEN not set, skipping notification');
        return;
    }

    const employeeNames = report.employees.join('、');
    const message = `📝 残業報告が届きました\n\n` +
        `📅 日付: ${report.date}\n` +
        `👥 報告者: ${employeeNames}\n` +
        `⏰ 種別: ${report.category}\n` +
        `🕐 時間: ${report.hours}h\n\n` +
        `報告時刻: ${new Date(report.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;

    // ブロードキャスト（全グループに送信）
    // 注: 本番では特定のグループIDに送信することを推奨
    try {
        await client.broadcast({
            type: 'text',
            text: message
        });
    } catch (error) {
        // Broadcast APIが使えない場合はスキップ
        console.log('Broadcast not available, notification skipped');
    }
}
