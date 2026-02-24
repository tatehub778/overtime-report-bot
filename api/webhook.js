const { Client, middleware } = require('@line/bot-sdk');
const { Redis } = require('@upstash/redis');

// Upstash Redis client
const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

// LINE Bot設定（オプショナル）
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || ''
};

let client = null;
if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
    client = new Client(config);
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // LINE署名検証
        const signature = req.headers['x-line-signature'];
        if (!signature) {
            return res.status(400).json({ error: 'No signature' });
        }

        // Webhookイベント処理
        const events = req.body.events;

        if (!events || events.length === 0) {
            return res.status(200).json({ message: 'No events' });
        }

        // デバッグ用：全イベントをログ出力
        events.forEach((event, index) => {
            console.log(`Event ${index}:`, JSON.stringify(event, null, 2));
            if (event.source && event.source.groupId) {
                console.log('🎯 GROUP_ID:', event.source.groupId);
            }
        });

        // 各イベントを処理
        await Promise.all(events.map(handleEvent));

        return res.status(200).json({ message: 'OK' });

    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// イベント処理
async function handleEvent(event) {
    // グループ参加イベント
    if (event.type === 'join') {
        console.log('Bot joined group:', JSON.stringify(event.source));

        if (!client) {
            return null;
        }

        // グループIDをログに出力
        if (event.source.type === 'group') {
            console.log('GROUP_ID:', event.source.groupId);

            // 参加メッセージを送信
            try {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '残業報告Botが参加しました！\n\nフォームから報告を送信すると、このグループに通知されます。\n\n「一覧」と送信すると、今月の報告を確認できます。'
                });
            } catch (error) {
                console.error('Failed to send join message:', error);
            }
        }

        return null;
    }

    // テキストメッセージのみ処理
    if (event.type !== 'message' || event.message.type !== 'text') {
        return null;
    }

    const messageText = event.message.text.trim();

    // グループID取得コマンド
    if (messageText === 'グループID' || messageText === 'ID教えて' || messageText === 'id' || messageText === 'ID') {
        if (!client) return null;

        let replyText = '';
        if (event.source.type === 'group') {
            replyText = `このグループのIDは:\n${event.source.groupId}\nです。`;
        } else if (event.source.type === 'room') {
            replyText = `このトークルームのIDは:\n${event.source.roomId}\nです。`;
        } else {
            replyText = `ここは個別のチャットです。\nあなたのユーザーIDは:\n${event.source.userId}\nです。`;
        }

        try {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: replyText
            });
        } catch (error) {
            console.error('Failed to reply with ID:', error);
        }
        return null; // 処理終了
    }

    // 「一覧」コマンド（月指定も対応）
    // 例: "一覧", "一覧 11月", "一覧 2024-11"
    if (messageText === '一覧' || messageText === 'いちらん' || messageText.startsWith('一覧 ') || messageText.startsWith('いちらん ')) {
        const parts = messageText.split(/\s+/);
        let month = null;

        if (parts.length > 1) {
            const monthParam = parts[1];
            // "11月" 形式
            if (monthParam.endsWith('月')) {
                const monthNum = monthParam.replace('月', '').padStart(2, '0');
                const currentYear = new Date().getFullYear();
                month = `${currentYear}-${monthNum}`;
            }
            // "2024-11" 形式
            else if (/^\d{4}-\d{1,2}$/.test(monthParam)) {
                const [year, mon] = monthParam.split('-');
                month = `${year}-${mon.padStart(2, '0')}`;
            }
        }

        return await handleListCommand(event, month);
    }

    return null;
}

// 一覧コマンド処理
async function handleListCommand(event, targetMonth = null) {
    try {
        // 指定された月、または今月のデータを取得
        const currentMonth = targetMonth || new Date().toISOString().substring(0, 7);
        const monthReportsKey = `reports:${currentMonth}`;
        const reportIds = await kv.smembers(monthReportsKey);

        if (!reportIds || reportIds.length === 0) {
            return await client.replyMessage(event.replyToken, {
                type: 'text',
                text: `📊 ${currentMonth.replace('-', '/')}月度 残業・夜勤状況\n\n報告がまだありません。`
            });
        }

        // レポートデータ取得
        const reports = [];
        for (const reportId of reportIds) {
            const reportData = await kv.get(`report:${reportId}`);
            if (reportData) {
                const report = typeof reportData === 'string' ? JSON.parse(reportData) : reportData;
                reports.push(report);
            }
        }

        // 社員ごとにグループ化
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

        // メッセージ整形
        let message = await formatSummaryMessage(currentMonth, employeeSummary, reports.length);



        return await client.replyMessage(event.replyToken, {
            type: 'text',
            text: message
        });

    } catch (error) {
        console.error('List command error:', error);
        return await client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'エラーが発生しました。もう一度お試しください。'
        });
    }
}

// サマリーメッセージ整形
async function formatSummaryMessage(month, employeeSummary, totalReports) {
    const [year, monthNum] = month.split('-');
    const today = new Date().getDate();

    let message = `📊 ${monthNum}月度 残業・夜勤状況（${monthNum}/${today} 現在）\n\n`;

    // 在籍者データを取得
    const employees = await getActiveEmployees();

    // 工場チームと管理チームに分類
    const factoryTeam = employees.filter(e => e.department === 'factory').map(e => e.name);
    const managementTeam = employees.filter(e => e.department === 'management').map(e => e.name);

    // 工場チーム
    message += '■工場\n';
    message += '━━━━━━━━━━━━━━━\n';

    const factoryWithReports = factoryTeam.filter(emp => employeeSummary[emp]);
    if (factoryWithReports.length > 0) {
        factoryWithReports.forEach(employee => {
            message += `\n■${employee}\n`;

            // 日付ごとにグループ化
            const reportsByDate = {};
            employeeSummary[employee].forEach(record => {
                if (!reportsByDate[record.date]) {
                    reportsByDate[record.date] = [];
                }
                reportsByDate[record.date].push(record);
            });

            // 日付順にソートして表示
            Object.keys(reportsByDate).sort().forEach(date => {
                const dateRecords = reportsByDate[date];
                const dateStr = date.substring(5).replace('-', '/'); // MM/DD

                // カテゴリと時間を結合
                const details = dateRecords
                    .map(r => `${r.category}${r.hours}h`)
                    .join(' + ');

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

            // 日付ごとにグループ化
            const reportsByDate = {};
            employeeSummary[employee].forEach(record => {
                if (!reportsByDate[record.date]) {
                    reportsByDate[record.date] = [];
                }
                reportsByDate[record.date].push(record);
            });

            // 日付順にソートして表示
            Object.keys(reportsByDate).sort().forEach(date => {
                const dateRecords = reportsByDate[date];
                const dateStr = date.substring(5).replace('-', '/'); // MM/DD

                // カテゴリと時間を結合
                const details = dateRecords
                    .map(r => `${r.category}${r.hours}h`)
                    .join(' + ');

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

// 在籍者取得ヘルパー関数
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

        // display_order順にソート（なければ名前順）
        employees.sort((a, b) => {
            if (a.display_order !== undefined && b.display_order !== undefined) {
                return a.display_order - b.display_order;
            }
            return a.name.localeCompare(b.name, 'ja');
        });

        return employees;
    } catch (error) {
        console.error('Error fetching employees:', error);
        // エラー時は空配列を返す
        return [];
    }
}
