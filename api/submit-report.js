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
        const { date, reports } = req.body;

        // バリデーション
        if (!date) {
            return res.status(400).json({ error: '日付を入力してください' });
        }

        if (!reports || !Array.isArray(reports) || reports.length === 0) {
            return res.status(400).json({ error: '従業員を選択してください' });
        }

        const now = new Date().toISOString();
        const savedReports = [];

        // 各従業員の各カテゴリごとにレポートを作成
        for (const employeeReport of reports) {
            const { employee, categories } = employeeReport;

            if (!categories || !Array.isArray(categories)) {
                return res.status(400).json({ error: `${employee}のカテゴリ情報が不正です` });
            }

            for (const cat of categories) {
                const reportId = uuidv4();

                const reportData = {
                    id: reportId,
                    date,
                    employees: [employee],
                    category: cat.category,
                    hours: parseFloat(cat.hours),
                    created_at: now,
                    updated_at: now
                };

                // Vercel KVに保存
                await kv.set(`report:${reportId}`, JSON.stringify(reportData));

                // 月別インデックスに追加
                const monthKey = date.substring(0, 7);
                const monthReportsKey = `reports:${monthKey}`;
                await kv.sadd(monthReportsKey, reportId);

                savedReports.push(reportData);
            }
        }

        // LINE通知を送信
        try {
            await sendLineNotification(date, reports, now);
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
async function sendLineNotification(date, reports, createdAt) {
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

    // **設定の確認**
    try {
        const lineEnabled = await kv.get('config:line_notification');
        console.log(`[SubmitReport] config:line_notification = ${lineEnabled} (${typeof lineEnabled})`);

        if (lineEnabled === false) {
            console.log('LINE notification disabled in settings (User Set OFF), skipping.');
            return;
        }
    } catch (confError) {
        console.error('Failed to fetching settings:', confError);
        // 設定取得エラーでもデフォルト(ON)として続行
    }

    // 各従業員の情報をフォーマット
    const employeeList = reports.map(r => {
        const categoryList = r.categories
            .map(c => `${c.category}${c.hours}時間`)
            .join('、');
        return `  • ${r.employee}: ${categoryList}`;
    }).join('\n');

    const message = `📝 残業報告が届きました\n\n` +
        `📅 日付: ${date}\n\n` +
        `👥 報告者:\n${employeeList}\n\n` +
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
