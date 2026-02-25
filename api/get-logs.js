const { Redis } = require('@upstash/redis');

const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const logKey = 'logs:submissions';

        // 最新の100件を取得 (降順)
        const logs = await kv.zrevrange(logKey, 0, 99);

        return res.status(200).json({
            success: true,
            logs: logs || []
        });

    } catch (error) {
        console.error('Fetch logs error:', error);
        return res.status(500).json({ error: 'ログの取得に失敗しました' });
    }
};
