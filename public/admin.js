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
        const response = await fetch(`/api/settings?t=${Date.now()}`);
        if (response.ok) {
            const data = await response.json();
            const toggle = document.getElementById('lineNotifyToggle');
            if (toggle) {
                toggle.checked = data.line_notification_enabled;
                toggle.addEventListener('change', handleSettingChange);
            }
        }
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

// 設定変更ハンドラ
async function handleSettingChange(e) {
    const enabled = e.target.checked;
    try {
        const response = await fetch('/api/settings', {
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
