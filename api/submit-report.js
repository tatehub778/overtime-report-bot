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
        console.log('[SubmitReport] Attempting to send LINE notification...');
        try {
            const result = await sendLineNotification(date, reports, now);
            console.log('[SubmitReport] LINE notification result:', result);
        } catch (lineError) {
            console.error('❌ LINE notification error:', lineError);

            // 429エラー（上限達成）を検知してKVに記録
            if (lineError.statusCode === 429 || (lineError.originalError && lineError.originalError.status === 429)) {
                console.warn('⚠️ LINE Push Message Quota Exceeded (429)');
                await kv.set('status:line_quota_exceeded', {
                    exceeded: true,
                    timestamp: new Date().toISOString()
                }, { ex: 86400 * 7 }); // 1週間保持
            }

            console.error('Error details:', JSON.stringify(lineError, null, 2));
            // LINE通知エラーでも報告は保存されているので続行
        }

        // Googleスプレッドシート(GAS)へ送信（バックアップ）
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        if (gasUrl) {
            console.log('[SubmitReport] Attempting to send to Google Sheets...');
            try {
                const gasResponse = await fetch(gasUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date, reports, now })
                });
                if (gasResponse.ok) {
                    console.log('✅ Sent to Google Sheets successfully');
                } else {
                    console.error('❌ Failed to send to Google Sheets:', gasResponse.statusText);
                }
            } catch (gasError) {
                console.error('❌ Error sending to Google Sheets:', gasError);
            }
        } else {
            console.log('[SubmitReport] GAS_WEBHOOK_URL not set, skipping backup');
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
    console.log('[sendLineNotification] START - date:', date, 'reports count:', reports.length);

    if (!client) {
        console.log('❌ LINE Bot not configured, skipping notification');
        return 'skipped: no client';
    }
    console.log('✓ LINE client configured');

    // グループIDの確認
    const groupId = process.env.LINE_GROUP_ID;
    console.log('[sendLineNotification] LINE_GROUP_ID:', groupId ? 'SET (hidden)' : 'NOT SET');
    if (!groupId) {
        console.log('❌ LINE_GROUP_ID not set, skipping notification');
        return 'skipped: no group id';
    }
    console.log('✓ GROUP_ID configured');

    // NOTE: トグル設定を無効化 - 常に通知を送信
    // 以前のトグル実装で通知が届かなくなったため、この機能は無効化されています
    console.log('[SubmitReport] LINE notification enabled (toggle feature disabled)');

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
    console.log('[sendLineNotification] Preparing to send message, length:', message.length);
    try {
        await client.pushMessage(groupId, {
            type: 'text',
            text: message
        });
        console.log('✅ LINE notification sent successfully to group:', groupId);
        return 'success';
    } catch (error) {
        console.error('❌ Failed to send LINE notification:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        throw error;
    }
}
