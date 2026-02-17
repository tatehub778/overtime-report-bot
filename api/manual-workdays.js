import { kv } from '@vercel/kv';

/**
 * 手動で出勤日/休日を設定・取得・削除するAPI
 */
export default async function handler(req, res) {
    // CORSヘッダー
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { month } = req.query;

        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({
                error: 'Invalid month format',
                details: 'Please provide month in YYYY-MM format'
            });
        }

        const key = `manual_workdays:${month}`;

        // GET: 指定月の手動設定一覧を取得
        if (req.method === 'GET') {
            const settings = await kv.get(key) || {};
            return res.status(200).json({
                success: true,
                month,
                settings
            });
        }

        // POST: 特定の日付を「出勤日」または「休日」として手動設定
        if (req.method === 'POST') {
            const { date, type } = req.body;

            if (!date || !/^\d{4}\/\d{2}\/\d{2}$/.test(date)) {
                return res.status(400).json({
                    error: 'Invalid date format',
                    details: 'Please provide date in YYYY/MM/DD format'
                });
            }

            if (!type || !['workday', 'holiday'].includes(type)) {
                return res.status(400).json({
                    error: 'Invalid type',
                    details: 'Type must be either "workday" or "holiday"'
                });
            }

            // 既存設定を取得
            const settings = await kv.get(key) || {};

            // 新しい設定を追加
            settings[date] = type;

            // 保存
            await kv.set(key, settings);

            console.log(`Manual workday setting saved: ${date} = ${type} for ${month}`);

            return res.status(200).json({
                success: true,
                month,
                date,
                type,
                message: `${date}を${type === 'workday' ? '出勤日' : '休日'}として設定しました`
            });
        }

        // DELETE: 手動設定を削除（自動判定に戻す）
        if (req.method === 'DELETE') {
            const { date } = req.body;

            if (!date || !/^\d{4}\/\d{2}\/\d{2}$/.test(date)) {
                return res.status(400).json({
                    error: 'Invalid date format',
                    details: 'Please provide date in YYYY/MM/DD format'
                });
            }

            // 既存設定を取得
            const settings = await kv.get(key) || {};

            // 設定を削除
            if (settings[date]) {
                delete settings[date];
                await kv.set(key, settings);

                console.log(`Manual workday setting removed: ${date} for ${month}`);

                return res.status(200).json({
                    success: true,
                    month,
                    date,
                    message: `${date}の手動設定を削除しました（自動判定に戻ります）`
                });
            } else {
                return res.status(404).json({
                    error: 'Setting not found',
                    details: `${date}に手動設定はありません`
                });
            }
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Error managing manual workdays:', error);
        return res.status(500).json({
            error: 'Failed to manage manual workdays',
            details: error.message
        });
    }
}
