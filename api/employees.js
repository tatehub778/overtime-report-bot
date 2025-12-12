const { Redis } = require('@upstash/redis');
const { v4: uuidv4 } = require('uuid');

// Upstash Redis client
const kv = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
    // CORSヘッダー
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // GET /api/employees - 社員一覧取得
        if (req.method === 'GET') {
            return await handleGetEmployees(req, res);
        }

        // POST /api/employees - 社員追加
        if (req.method === 'POST') {
            return await handleCreateEmployee(req, res);
        }

        // PUT /api/employees - 社員更新（IDはクエリパラメータで）
        if (req.method === 'PUT') {
            return await handleUpdateEmployee(req, res);
        }

        // PATCH /api/employees - 有効/無効トグル
        if (req.method === 'PATCH') {
            return await handleToggleEmployee(req, res);
        }

        // DELETE /api/employees - 社員削除
        if (req.method === 'DELETE') {
            return await handleDeleteEmployee(req, res);
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Employee API error:', error);
        return res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
};

// 社員一覧取得
async function handleGetEmployees(req, res) {
    const { active } = req.query;

    // 全社員ID取得
    const employeeIds = await kv.smembers('employees:all') || [];

    if (employeeIds.length === 0) {
        return res.status(200).json([]);
    }

    // 各社員データ取得
    const employees = [];
    for (const id of employeeIds) {
        const employeeData = await kv.get(`employee:${id}`);
        if (employeeData) {
            const employee = typeof employeeData === 'string'
                ? JSON.parse(employeeData)
                : employeeData;

            // activeフィルタ
            if (active === 'true' && !employee.active) {
                continue;
            }
            if (active === 'false' && employee.active) {
                continue;
            }

            employees.push(employee);
        }
    }

    // 名前順にソート
    employees.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    return res.status(200).json(employees);
}

// 社員追加
async function handleCreateEmployee(req, res) {
    const { name, cboName, department } = req.body;

    // バリデーション
    if (!name || !cboName || !department) {
        return res.status(400).json({
            error: '名前、CBOでの名前、所属は必須です'
        });
    }

    if (!['factory', 'management'].includes(department)) {
        return res.status(400).json({
            error: '所属は factory または management を指定してください'
        });
    }

    // 新規ID生成
    const id = `emp_${uuidv4().substring(0, 8)}`;

    const employee = {
        id,
        name,
        cboName,
        department,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    // 保存
    await kv.set(`employee:${id}`, JSON.stringify(employee));
    await kv.sadd('employees:all', id);
    await kv.sadd('employees:active', id);

    return res.status(201).json(employee);
}

// 社員更新
async function handleUpdateEmployee(req, res) {
    const { id } = req.query;
    const { name, cboName, department } = req.body;

    if (!id) {
        return res.status(400).json({ error: 'IDが必要です' });
    }

    // 既存データ取得
    const existingData = await kv.get(`employee:${id}`);
    if (!existingData) {
        return res.status(404).json({ error: '社員が見つかりません' });
    }

    const existing = typeof existingData === 'string'
        ? JSON.parse(existingData)
        : existingData;

    // 更新
    const updated = {
        ...existing,
        name: name || existing.name,
        cboName: cboName || existing.cboName,
        department: department || existing.department,
        updatedAt: new Date().toISOString()
    };

    await kv.set(`employee:${id}`, JSON.stringify(updated));

    return res.status(200).json(updated);
}

// 有効/無効トグル
async function handleToggleEmployee(req, res) {
    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: 'IDが必要です' });
    }

    // 既存データ取得
    const existingData = await kv.get(`employee:${id}`);
    if (!existingData) {
        return res.status(404).json({ error: '社員が見つかりません' });
    }

    const existing = typeof existingData === 'string'
        ? JSON.parse(existingData)
        : existingData;

    // トグル
    const updated = {
        ...existing,
        active: !existing.active,
        updatedAt: new Date().toISOString()
    };

    await kv.set(`employee:${id}`, JSON.stringify(updated));

    // activeセット更新
    if (updated.active) {
        await kv.sadd('employees:active', id);
    } else {
        await kv.srem('employees:active', id);
    }

    return res.status(200).json(updated);
}

// 社員削除
async function handleDeleteEmployee(req, res) {
    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ error: 'IDが必要です' });
    }

    // 削除
    await kv.del(`employee:${id}`);
    await kv.srem('employees:all', id);
    await kv.srem('employees:active', id);

    return res.status(200).json({ message: '削除しました' });
}
