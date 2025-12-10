const { Redis } = require('@upstash/redis');

// Upstash Redis client
const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
    // CORSヘッダー
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // クエリパラメータから月を取得（デフォルトは今月）
        const month = req.query.month || new Date().toISOString().substring(0, 7);

        // 月別のレポートIDを取得
        const monthReportsKey = `reports:${month}`;
        const reportIds = await kv.smembers(monthReportsKey);

        if (!reportIds || reportIds.length === 0) {
            return res.status(200).json({
                month,
                reports: [],
                summary: {}
            });
        }

        // 各レポートのデータを取得
        const reports = [];
        for (const reportId of reportIds) {
            const reportData = await kv.get(`report:${reportId}`);
            if (reportData) {
                const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
                reports.push(report);
            }
        }

        // 日付順にソート
        reports.sort((a, b) => new Date(a.date) - new Date(b.date));

        // 社員ごとにグループ化
        const summary = {};
        reports.forEach(report => {
            report.employees.forEach(employee => {
                if (!summary[employee]) {
                    summary[employee] = [];
                }
                summary[employee].push({
                    date: report.date,
                    category: report.category,
                    hours: report.hours
                });
            });
        });

        return res.status(200).json({
            month,
            reports,
            summary
        });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
};
