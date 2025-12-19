const { Redis } = require('@upstash/redis');

// Upstash Redis client
const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            const lineEnabled = await kv.get('config:line_notification');
            console.log(`[Settings] GET config:line_notification = ${lineEnabled} (${typeof lineEnabled})`);
            console.log(`[Settings] LINE_GROUP_ID configured: ${!!process.env.LINE_GROUP_ID}`);
            console.log(`[Settings] LINE_CHANNEL_ACCESS_TOKEN configured: ${!!process.env.LINE_CHANNEL_ACCESS_TOKEN}`);

            return res.status(200).json({
                line_notification_enabled: lineEnabled !== false, // Default to true if null/undefined
                line_configured: !!process.env.LINE_GROUP_ID, // Check if ENV is set
                raw_value: lineEnabled, // デバッグ用に生の値も返す
                env_check: {
                    has_group_id: !!process.env.LINE_GROUP_ID,
                    has_access_token: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
                    has_channel_secret: !!process.env.LINE_CHANNEL_SECRET
                }
            });
        } else if (req.method === 'POST') {
            const { line_notification_enabled } = req.body;
            console.log(`[Settings] POST update: ${line_notification_enabled}`);

            // Check specifically for boolean to allow false
            if (typeof line_notification_enabled !== 'boolean') {
                return res.status(400).json({ error: 'Invalid value' });
            }

            await kv.set('config:line_notification', line_notification_enabled);
            console.log(`[Settings] Successfully saved: ${line_notification_enabled}`);
            return res.status(200).json({ success: true, line_notification_enabled });
        } else if (req.method === 'DELETE') {
            // 設定をリセット（削除してデフォルトに戻す）
            await kv.del('config:line_notification');
            console.log('[Settings] Reset line_notification to default (enabled)');
            return res.status(200).json({
                success: true,
                message: 'LINE通知設定をデフォルト（有効）にリセットしました'
            });
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Settings API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
