const { Redis } = require('@upstash/redis');

// Upstash Redis client
const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            const lineEnabled = await kv.get('config:line_notification');
            return res.status(200).json({
                line_notification_enabled: lineEnabled !== false // Default to true if null
            });
        } else if (req.method === 'POST') {
            const { line_notification_enabled } = req.body;
            // Check specifically for boolean to allow false
            if (typeof line_notification_enabled !== 'boolean') {
                return res.status(400).json({ error: 'Invalid value' });
            }

            await kv.set('config:line_notification', line_notification_enabled);
            return res.status(200).json({ success: true, line_notification_enabled });
        } else {
            return res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Settings API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
