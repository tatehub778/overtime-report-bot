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
        const targetMonth = req.query.month || new Date().toISOString().substring(0, 7);
        const monthReportsKey = `reports:${targetMonth}`;
        const reportIds = await kv.smembers(monthReportsKey);

        if (!reportIds || reportIds.length === 0) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            return res.status(200).send(`📊 ${targetMonth.replace('-', '/')}月度 残業・夜勤状況\n\n報告がまだありません。`);
        }

        const reports = [];
        for (const reportId of reportIds) {
            const reportData = await kv.get(`report:${reportId}`);
            if (reportData) {
                const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
                reports.push(report);
            }
        }

        const employeeSummary = {};
        reports.forEach(report => {
            report.employees.forEach(employee => {
                if (!employeeSummary[employee]) {
                    employeeSummary[employee] = [];
                }
                employeeSummary[employee].push({
                    date: report.date,
                    category: report.category,
                    hours: report.hours
                });
            });
        });

        const message = await formatSummaryMessage(targetMonth, employeeSummary, reports.length);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(message);

    } catch (error) {
        console.error('List command error:', error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(500).send('エラーが発生しました。もう一度お試しください。');
    }
};

async function formatSummaryMessage(month, employeeSummary, totalReports) {
    const [year, monthNum] = month.split('-');
    const today = new Date().getDate();

    let message = `📊 ${monthNum}月度 残業・夜勤状況（${monthNum}/${today} 現在）\n\n`;

    const employees = await getActiveEmployees();

    const factoryTeam = employees.filter(e => e.department === 'factory').map(e => e.name);
    const managementTeam = employees.filter(e => e.department === 'management').map(e => e.name);

    message += '■工場\n';
    message += '━━━━━━━━━━━━━━━\n';

    const factoryWithReports = factoryTeam.filter(emp => employeeSummary[emp]);
    if (factoryWithReports.length > 0) {
        factoryWithReports.forEach(employee => {
            message += `\n■${employee}\n`;

            const reportsByDate = {};
            employeeSummary[employee].forEach(record => {
                if (!reportsByDate[record.date]) {
                    reportsByDate[record.date] = [];
                }
                reportsByDate[record.date].push(record);
            });

            Object.keys(reportsByDate).sort().forEach(date => {
                const dateRecords = reportsByDate[date];
                const dateStr = date.substring(5).replace('-', '/');
                const details = dateRecords.map(r => `${r.category}${r.hours}h`).join(' + ');
                message += `${dateStr}  ${details}\n`;
            });
        });
    } else {
        message += 'なし\n';
    }

    message += '\n■管理\n';
    message += '━━━━━━━━━━━━━━━\n';

    const managementWithReports = managementTeam.filter(emp => employeeSummary[emp]);
    if (managementWithReports.length > 0) {
        managementWithReports.forEach(employee => {
            message += `\n■${employee}\n`;

            const reportsByDate = {};
            employeeSummary[employee].forEach(record => {
                if (!reportsByDate[record.date]) {
                    reportsByDate[record.date] = [];
                }
                reportsByDate[record.date].push(record);
            });

            Object.keys(reportsByDate).sort().forEach(date => {
                const dateRecords = reportsByDate[date];
                const dateStr = date.substring(5).replace('-', '/');
                const details = dateRecords.map(r => `${r.category}${r.hours}h`).join(' + ');
                message += `${dateStr}  ${details}\n`;
            });
        });
    } else {
        message += 'なし\n';
    }

    message += '\n━━━━━━━━━━━━━━━\n';
    message += `合計: ${totalReports}件の報告`;

    return message;
}

async function getActiveEmployees() {
    try {
        const employeeIds = await kv.smembers('employees:active') || [];
        const employees = [];

        for (const id of employeeIds) {
            const employeeData = await kv.get(`employee:${id}`);
            if (employeeData) {
                const employee = typeof employeeData === 'string'
                    ? JSON.parse(employeeData)
                    : employeeData;
                employees.push(employee);
            }
        }

        employees.sort((a, b) => {
            if (a.display_order !== undefined && b.display_order !== undefined) {
                return a.display_order - b.display_order;
            }
            return a.name.localeCompare(b.name, 'ja');
        });

        return employees;
    } catch (error) {
        console.error('Error fetching employees:', error);
        return [];
    }
}
