// グローバル変数
let employees = [];

// ページ読み込み時
document.addEventListener('DOMContentLoaded', async () => {
    await loadEmployees();
    await loadSettings();

    // イベントリスナー
    document.getElementById('addForm').addEventListener('submit', handleAddEmployee);
    document.getElementById('editForm').addEventListener('submit', handleEditEmployee);
    document.getElementById('showInactive').addEventListener('change', renderEmployees);
});

// 設定読み込み
async function loadSettings() {
    try {
        const response = await fetch(`/api/manage-report?type=settings&t=${Date.now()}`);
        if (response.ok) {
            const data = await response.json();

            // デバッグ情報の表示（トグルの有無に関わらず表示）
            const settingInfo = document.querySelector('.setting-info');
            if (settingInfo) {
                // 既存の警告・デバッグ情報を削除
                const existingDebug = document.getElementById('line-debug-info');
                if (existingDebug) existingDebug.remove();
                const existingWarning = document.getElementById('line-warning');
                if (existingWarning) existingWarning.remove();

                // デバッグ情報を作成
                const debugInfo = document.createElement('div');
                debugInfo.id = 'line-debug-info';
                debugInfo.style.fontSize = '0.75em';
                debugInfo.style.marginTop = '8px';
                debugInfo.style.padding = '12px';
                debugInfo.style.background = '#f8fafc';
                debugInfo.style.border = '1px solid #e2e8f0';
                debugInfo.style.borderRadius = '6px';
                debugInfo.style.fontFamily = 'monospace';

                const toggle = document.getElementById('lineNotificationEnabled');
                if (toggle) {
                    toggle.checked = data.line_notification_enabled;
                }

                let debugHtml = `<strong>🔍 システム診断:</strong><br><br>`;
                debugHtml += `設定値: ${data.line_notification_enabled ? '有効' : '無効'} (生の値: ${data.raw_value})<br>`;
                debugHtml += `通知エンジン: ${data.line_notification_enabled ? 'ON' : 'OFF'}<br><br>`;
                debugHtml += `<strong>環境変数チェック:</strong><br>`;
                debugHtml += `GROUP_ID: ${data.env_check?.has_group_id ? '✅ 設定済み' : '❌ 未設定'}<br>`;
                debugHtml += `ACCESS_TOKEN: ${data.env_check?.has_access_token ? '✅ 設定済み' : '❌ 未設定'}<br>`;
                debugHtml += `CHANNEL_SECRET: ${data.env_check?.has_channel_secret ? '✅ 設定済み' : '❌ 未設定'}<br>`;
                debugHtml += `GAS_URL: ${data.env_check?.has_gas_url ? '✅ 設定済み(バックアップ有効)' : '❌ 未設定'}<br><br>`;

                if (data.quota_status?.exceeded) {
                    debugHtml += `<div style="color:#dc2626; font-weight:bold; padding:8px; border:1px solid #dc2626; border-radius:4px; margin-top:12px; background:#fef2f2;">
                        ⚠️ LINE送信枠の上限超えを検知しました<br>
                        <span style="font-size:0.9em; font-weight:normal;">(発生: ${new Date(data.quota_status.timestamp).toLocaleString()})</span><br>
                        今月の無料枠を使い切った可能性があります。
                    </div>`;
                }

                debugHtml += `<div style="margin-top:12px; display:flex; gap:8px;">
                    <button onclick="testNotification()" style="padding:6px 12px; background:#4f46e5; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px;">🔔 テスト通知を送信</button>
                    <button onclick="resetLineSettings()" style="padding:6px 12px; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px;">⚠️ 設定をリセット</button>
                </div>`;

                debugInfo.innerHTML = debugHtml;
                settingInfo.appendChild(debugInfo);

                // 設定警告の表示
                if (data.env_check?.has_group_id === false) {
                    const warning = document.createElement('div');
                    warning.id = 'line-warning';
                    warning.style.color = '#dc2626';
                    warning.style.fontSize = '0.85em';
                    warning.style.marginTop = '8px';
                    warning.style.fontWeight = 'bold';
                    warning.innerHTML = '⚠️ LINE_GROUP_IDが設定されていないため、通知は送信されません。Vercelの環境変数を確認してください。';
                    settingInfo.appendChild(warning);
                }
            }
        }
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

// テスト通知送信
async function testNotification() {
    if (!confirm('LINEグループにテスト通知を送信しますか？')) return;

    try {
        const response = await fetch('/api/submit-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: new Date().toISOString().substring(0, 10),
                reports: [{
                    employee: 'システムテスト',
                    categories: [{ category: 'テスト', hours: 0 }]
                }]
            })
        });

        const result = await response.json();
        if (response.ok) {
            alert('✅ 送信リクエストが完了しました。\nLINEグループを確認してください。\n\nもし届かない場合はVercelのログを確認してください。');
        } else {
            alert('❌ 送信失敗: ' + result.error);
        }
    } catch (error) {
        console.error('Test notification failed:', error);
        alert('❌ 接続エラーが発生しました');
    }
}

// 設定変更ハンドラ
async function handleSettingChange(e) {
    const enabled = e.target.checked;
    try {
        const response = await fetch('/api/manage-report?type=settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line_notification_enabled: enabled })
        });

        if (!response.ok) throw new Error('Save failed');

    } catch (error) {
        console.error('Failed to save setting', error);
        alert('設定の保存に失敗しました');
        e.target.checked = !enabled; // 元に戻す
    }
}

// 社員データ読み込み
async function loadEmployees() {
    try {
        const response = await fetch(`/api/employees?t=${Date.now()}`);
        if (!response.ok) throw new Error('Failed to load employees');

        employees = await response.json();
        renderEmployees();
    } catch (error) {
        console.error('Error loading employees:', error);
        alert('社員データの読み込みに失敗しました');
    }
}

// 社員リスト表示
function renderEmployees() {
    const showInactive = document.getElementById('showInactive').checked;
    const factoryList = document.getElementById('factoryList');
    const managementList = document.getElementById('managementList');

    // フィルタ
    const visibleEmployees = showInactive
        ? employees
        : employees.filter(e => e.active);

    // 工場チーム
    const factoryEmployees = visibleEmployees.filter(e => e.department === 'factory');
    factoryList.innerHTML = factoryEmployees.length > 0
        ? factoryEmployees.map(renderEmployeeCard).join('')
        : '<div class="empty-state"><div class="empty-state-icon">📭</div><p>社員がいません</p></div>';

    // 管理チーム
    const managementEmployees = visibleEmployees.filter(e => e.department === 'management');
    managementList.innerHTML = managementEmployees.length > 0
        ? managementEmployees.map(renderEmployeeCard).join('')
        : '<div class="empty-state"><div class="empty-state-icon">📭</div><p>社員がいません</p></div>';
}

// 社員カード生成
function renderEmployeeCard(employee) {
    return `
        <div class="employee-card ${employee.active ? '' : 'inactive'}">
            <div class="employee-header">
                <div class="employee-name">${employee.name}</div>
                <span class="status-badge ${employee.active ? 'active' : 'inactive'}">
                    ${employee.active ? '在籍中' : '退職'}
                </span>
            </div>
            <div class="employee-info">
                <div><strong>CBO:</strong> ${employee.cboName}</div>
                <div><strong>所属:</strong> ${employee.department === 'factory' ? '🏭 工場' : '🏢 管理'}</div>
            </div>
            <div class="employee-actions">
                <button class="btn btn-small btn-primary" onclick="openEditModal('${employee.id}')">
                    ✏️ 編集
                </button>
                <button class="btn btn-small ${employee.active ? 'btn-warning' : 'btn-success'}" 
                        onclick="toggleEmployee('${employee.id}')">
                    ${employee.active ? '⏸️ 無効化' : '▶️ 有効化'}
                </button>
                <button class="btn btn-small btn-danger" onclick="deleteEmployee('${employee.id}')">
                    🗑️ 削除
                </button>
            </div>
        </div>
    `;
}

// 社員追加
async function handleAddEmployee(e) {
    e.preventDefault();

    const data = {
        name: document.getElementById('name').value.trim(),
        cboName: document.getElementById('cboName').value.trim(),
        department: document.getElementById('department').value
    };

    try {
        const response = await fetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }

        alert('✅ 社員を追加しました');
        document.getElementById('addForm').reset();
        await loadEmployees();
    } catch (error) {
        console.error('Error adding employee:', error);
        alert('❌ エラー: ' + error.message);
    }
}

// 編集モーダルを開く
function openEditModal(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    document.getElementById('editId').value = employee.id;
    document.getElementById('editName').value = employee.name;
    document.getElementById('editCboName').value = employee.cboName;
    document.getElementById('editDepartment').value = employee.department;

    document.getElementById('editModal').classList.add('active');
}

// 編集モーダルを閉じる
function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
    document.getElementById('editForm').reset();
}

// 社員情報更新
async function handleEditEmployee(e) {
    e.preventDefault();

    const id = document.getElementById('editId').value;
    const data = {
        name: document.getElementById('editName').value.trim(),
        cboName: document.getElementById('editCboName').value.trim(),
        department: document.getElementById('editDepartment').value
    };

    try {
        const response = await fetch(`/api/employees?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }

        alert('✅ 社員情報を更新しました');
        closeEditModal();
        await loadEmployees();
    } catch (error) {
        console.error('Error updating employee:', error);
        alert('❌ エラー: ' + error.message);
    }
}

// 有効/無効トグル
async function toggleEmployee(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    const action = employee.active ? '無効化' : '有効化';
    if (!confirm(`${employee.name} さんを${action}しますか？`)) return;

    try {
        const response = await fetch(`/api/employees?id=${employeeId}`, {
            method: 'PATCH'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }

        alert(`✅ ${action}しました`);
        await loadEmployees();
    } catch (error) {
        console.error('Error toggling employee:', error);
        alert('❌ エラー: ' + error.message);
    }
}

// 社員削除
async function deleteEmployee(employeeId) {
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return;

    if (!confirm(`${employee.name} さんを削除しますか？\n\nこの操作は取り消せません。`)) return;

    try {
        const response = await fetch(`/api/employees?id=${employeeId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error);
        }

        alert('✅ 削除しました');
        await loadEmployees();
    } catch (error) {
        console.error('Error deleting employee:', error);
        alert('❌ エラー: ' + error.message);
    }
}

// LINE設定リセット
async function resetLineSettings() {
    if (!confirm('LINE通知設定をデフォルト（有効）にリセットしますか？')) return;

    try {
        const response = await fetch('/api/manage-report?type=settings', {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Reset failed');
        }

        const result = await response.json();
        alert(`✅ ${result.message}`);

        // 設定を再読み込み
        await loadSettings();
    } catch (error) {
        console.error('Failed to reset settings:', error);
        alert('❌ リセットに失敗しました');
    }
}
