import { kv } from '@vercel/kv';

/**
 * CBO検証のチェック状態を更新するAPI
 * 本人確認チェックと事務確認チェックの両方に対応
 */
export default async function handler(req, res) {
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
        const { month, employee, date, checkType, checked } = req.body;

        // バリデーション
        if (!month || !employee || !date || !checkType) {
            return res.status(400).json({
                error: 'Missing required fields',
                details: 'month, employee, date, and checkType are required'
            });
        }

        if (checkType !== 'self' && checkType !== 'admin') {
            return res.status(400).json({
                error: 'Invalid checkType',
                details: 'checkType must be either "self" or "admin"'
            });
        }

        // 検証結果を取得
        const verificationKey = `verification_result:${month}`;
        const verificationData = await kv.get(verificationKey);

        if (!verificationData) {
            return res.status(404).json({
                error: 'Verification data not found',
                details: `No verification data found for ${month}`
            });
        }

        // 該当する従業員のレコードを更新
        let recordFound = false;
        let updatedCount = 0;

        if (verificationData.by_employee) {
            for (const empData of verificationData.by_employee) {
                if (empData.employee === employee) {
                    for (const record of empData.records) {
                        if (record.date === date) {
                            // チェック状態を更新
                            if (checkType === 'self') {
                                record.self_checked = checked;
                                record.self_checked_at = checked ? new Date().toISOString() : null;
                            } else if (checkType === 'admin') {
                                record.admin_checked = checked;
                                record.admin_checked_at = checked ? new Date().toISOString() : null;
                            }
                            recordFound = true;
                            updatedCount++;
                        }
                    }
                }
            }
        }

        if (!recordFound) {
            return res.status(404).json({
                error: 'Record not found',
                details: `No record found for ${employee} on ${date}`
            });
        }

        // --- 永続化対応: チェック状態を別途保存 ---
        const checksKey = `verification_checks:${month}`;
        const checkField = `${employee}|${date}`;

        // 既存の保存済みチェック状態を取得
        let savedCheck = await kv.hget(checksKey, checkField) || {};

        // 更新
        if (checkType === 'self') {
            savedCheck.self = checked;
            savedCheck.self_at = checked ? new Date().toISOString() : null;
        } else if (checkType === 'admin') {
            savedCheck.admin = checked;
            savedCheck.admin_at = checked ? new Date().toISOString() : null;
        }

        await kv.hset(checksKey, { [checkField]: savedCheck });

        // 更新した検証結果を保存
        await kv.set(verificationKey, verificationData);

        console.log(`Updated ${checkType} check for ${employee} on ${date}: ${checked}`);

        return res.status(200).json({
            success: true,
            message: 'Check status updated',
            updated: {
                month,
                employee,
                date,
                checkType,
                checked,
                count: updatedCount
            }
        });

    } catch (error) {
        console.error('Error updating verification check:', error);
        return res.status(500).json({
            error: 'Failed to update check status',
            details: error.message
        });
    }
}
