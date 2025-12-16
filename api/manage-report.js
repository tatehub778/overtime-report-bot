const { Redis } = require('@upstash/redis');

// Upstash Redis client
const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'DELETE, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'DELETE') {
        return handleDelete(req, res);
    } else if (req.method === 'PUT') {
        return handleUpdate(req, res);
    } else {
        return res.status(405).json({ error: 'Method not allowed' });
    }
}

async function handleDelete(req, res) {
    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({ error: 'Report ID is required' });
        }

        // Get report to find the date for index cleanup
        const reportData = await kv.get(`report:${id}`);
        if (!reportData) {
            return res.status(404).json({ error: 'Report not found' });
        }

        const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
        const date = report.date;
        const monthKey = date.substring(0, 7);

        // Remove from month index
        await kv.srem(`reports:${monthKey}`, id);

        // Delete report data
        await kv.del(`report:${id}`);

        console.log(`Deleted report ${id}`);
        return res.status(200).json({ success: true, message: 'Report deleted' });

    } catch (error) {
        console.error('Delete error:', error);
        return res.status(500).json({ error: 'Failed to delete report' });
    }
}

async function handleUpdate(req, res) {
    try {
        const { id } = req.query;
        const { hours, category, date } = req.body;

        if (!id) {
            return res.status(400).json({ error: 'Report ID is required' });
        }

        // Get existing report
        const reportData = await kv.get(`report:${id}`);
        if (!reportData) {
            return res.status(404).json({ error: 'Report not found' });
        }

        const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
        const oldDate = report.date;

        // Update fields
        if (hours) report.hours = parseFloat(hours);
        if (category) report.category = category;

        if (date && date !== oldDate) {
            // Handle date change
            const oldMonthKey = oldDate.substring(0, 7);
            const newMonthKey = date.substring(0, 7);

            if (oldMonthKey !== newMonthKey) {
                await kv.srem(`reports:${oldMonthKey}`, id);
                await kv.sadd(`reports:${newMonthKey}`, id);
            }
            report.date = date;
        }

        report.updated_at = new Date().toISOString();

        // Save back
        await kv.set(`report:${id}`, JSON.stringify(report));

        console.log(`Updated report ${id}`);
        return res.status(200).json({ success: true, message: 'Report updated', report });

    } catch (error) {
        console.error('Update error:', error);
        return res.status(500).json({ error: 'Failed to update report' });
    }
}
