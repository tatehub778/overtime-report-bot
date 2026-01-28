// API Base URL
const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : '/api';

// DOM要素
const targetMonth = document.getElementById('target-month');
const resultSection = document.getElementById('result-section');
const resultContainer = document.getElementById('factory-result-container');

// グローバル変数
let verificationData = null;

// 初期化
function init() {
    // デフォルト月を今月に設定
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    targetMonth.value = currentMonth;

    // イベントリスナー
    targetMonth.addEventListener('change', checkExistingData);

    // Modal Listeners
    document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);
    document.getElementById('close-modal').addEventListener('click', closeEditModal);
    document.getElementById('btn-cancel').addEventListener('click', closeEditModal);
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('edit-modal')) {
            closeEditModal();
        }
    });

    // 初期ロード時にデータをチェック
    checkExistingData();
}

// 既存データのチェック / 検証実行 (工場用は常に department: 'factory' を送る)
async function checkExistingData() {
    const month = targetMonth.value;
    if (!month) return;

    try {
        // 工場用は常にサーバーサイドでフィルタリングさせる
        const response = await fetch(`${API_BASE}/verify-cbo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                month,
                force_refresh: false,
                department: 'factory' // 重要: 工場メンバーのみ取得
            })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.verification) {
                verificationData = result.verification;
                displayVerificationResult(verificationData);
            } else {
                resultSection.style.display = 'none';
            }
        } else {
            resultSection.style.display = 'none';
        }
    } catch (error) {
        console.error('Error fetching factory data:', error);
        resultSection.style.display = 'none';
    }
}

// 検証結果表示
function displayVerificationResult(data) {
    // サマリーカード更新
    document.getElementById('matches-count').textContent = data.summary.matches;
    document.getElementById('missing-count').textContent = data.summary.missing_reports;
    document.getElementById('excess-count').textContent = data.summary.excess_reports;
    document.getElementById('discrepancy-count').textContent = data.summary.time_discrepancies;

    // メンバー別の表示（工場メンバーのみが返ってきている前提）
    if (data.by_employee) {
        renderByEmployee(data.by_employee);
    }

    // 結果セクションを表示
    resultSection.style.display = 'block';
}

// 従業員ごとの表示
function renderByEmployee(byEmployee) {
    let html = '';

    if (byEmployee.length === 0) {
        resultContainer.innerHTML = '<p style="text-align: center; padding: 20px; color: #6B7280;">対象のデータがありません</p>';
        return;
    }

    byEmployee.forEach(emp => {
        const hasIssues = emp.issues > 0;
        const borderColor = hasIssues ? '#EF4444' : '#10B981';

        html += `
            <div class="employee-card" style="
                margin: 15px 0;
                padding: 15px;
                border-radius: 8px;
                background: white;
                border-left: 4px solid ${borderColor};
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0; font-size: 18px; color: #1F2937;">${emp.employee}</h3>
                    <div style="display: flex; gap: 10px; font-size: 13px;">
                        <span style="color: #10B981;">✅ ${emp.matches}件</span>
                        ${emp.issues > 0 ? `<span style="color: #EF4444; font-weight: 600;">⚠️ ${emp.issues}件</span>` : ''}
                    </div>
                </div>
                <div style="border-top: 1px solid #E5E7EB; padding-top: 10px;">
        `;

        emp.records.forEach(record => {
            const date = record.date.substring(5).replace('/', '/'); // MM/DD
            const statusColor = {
                'match': '#10B981',
                'discrepancy': '#F59E0B',
                'excess': '#EF4444',
                'missing': '#F59E0B',
                'no_punch': '#EF4444'
            }[record.status] || '#6B7280';

            let statusText = '';
            if (record.status === 'match') {
                statusText = '一致';
            } else if (record.status === 'discrepancy') {
                statusText = `時間ずれ CBO: ${record.cbo_hours}h / システム: ${record.system_hours}h`;
            } else if (record.status === 'excess') {
                statusText = `過剰報告 CBO: ${record.cbo_hours}h / システム: ${record.system_hours}h`;
            } else if (record.status === 'missing') {
                statusText = `未報告 CBO: ${record.cbo_hours}h / システム: ${record.system_hours}h`;
            } else if (record.status === 'no_punch') {
                statusText = '打刻自体なし';
            }

            // ロック判定（工場用も事務のチェック済みならロック）
            const isLocked = record.self_checked && record.admin_checked;
            const lockedStyle = isLocked ? 'style="background-color: #f3f4f6; opacity: 0.9;"' : '';

            html += `
                <div class="record-row ${record.status}" ${lockedStyle}>
                    <div class="record-main" style="display: flex; justify-content: space-between; align-items: center;">
                        <div class="record-info">
                            <span class="record-icon">${record.icon}</span>
                            <span class="record-date">${date}</span>
                            <span class="record-status" style="color: ${statusColor}; font-weight: 500;">${statusText}</span>
                            ${isLocked ? '<span style="margin-left:8px; font-size: 0.8em; color:#6B7280;">🔒 確認済み</span>' : ''}
                        </div>
                        
                        <div class="record-checks">
                            <label class="check-label self-check" style="cursor: ${isLocked ? 'default' : 'pointer'};">
                                <input type="checkbox" 
                                    class="check-box" 
                                    data-month="${verificationData.month}"
                                    data-employee="${emp.employee}"
                                    data-date="${record.date}"
                                    data-type="self"
                                    ${record.self_checked ? 'checked' : ''}
                                    ${isLocked ? 'disabled' : ''}
                                    onchange="handleCheckChange(this)">
                                <span>本人確認</span>
                            </label>
                            
                            <!-- 事務チェックは工場用では表示のみ (disabled) -->
                            <label class="check-label admin-check" style="margin-left: 10px; opacity: 0.6;">
                                <input type="checkbox" disabled ${record.admin_checked ? 'checked' : ''}>
                                <span>事務</span>
                            </label>
                        </div>
                    </div>
                    ${renderSystemDetails(record, emp.employee, isLocked)}
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    resultContainer.innerHTML = html;
}

// システム詳細（編集用ボタン付き）
function renderSystemDetails(record, employeeName, isLocked = false) {
    if (!record.system_details || record.system_details.length === 0) return '';

    let html = '<div class="system-details-list" style="margin-top: 5px; padding-left: 28px;">';
    html += record.system_details.map(detail => `
            <div class="system-detail-item" style="font-size: 0.85em; color: #666; margin-bottom: 3px; display: flex; justify-content: space-between;">
                <span>📝 報告: <strong>${detail.category}</strong> ${detail.hours}h</span>
                <div class="report-actions">
                    <button class="btn-sm" 
                        onclick="openEditReport('${detail.id}', '${record.date}', '${employeeName.replace(/'/g, "\\'")}', '${detail.category}', ${detail.hours})"
                        style="background: none; border: 1px solid #d1d5db; border-radius: 4px; padding: 2px 6px; cursor: ${isLocked ? 'default' : 'pointer'}; ${isLocked ? 'display: none;' : ''}">
                        編集
                    </button>
                </div>
            </div>
        `).join('');
    html += '</div>';
    return html;
}

// チェックボックスの状態変更ハンドラー
async function handleCheckChange(checkbox) {
    const { month, employee, date, type: checkType } = checkbox.dataset;
    const checked = checkbox.checked;

    try {
        checkbox.disabled = true;
        const response = await fetch(`${API_BASE}/update-verification-check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month, employee, date, checkType, checked })
        });

        if (!response.ok) throw new Error('更新に失敗しました');

        // 成功したら色を一時的に変えるなどの演出（任意）
    } catch (error) {
        console.error('Error updating check:', error);
        alert(`エラー: ${error.message}`);
        checkbox.checked = !checked;
    } finally {
        checkbox.disabled = false;
    }
}

// 編集モーダル操作
function openEditReport(id, date, employee, category, hours) {
    document.getElementById('edit-report-id').value = id;
    document.getElementById('edit-date').value = date;
    document.getElementById('edit-employee').value = employee;
    document.getElementById('edit-category').value = category;
    document.getElementById('edit-hours').value = hours;
    document.getElementById('edit-modal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

async function handleEditSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-report-id').value;
    const hours = document.getElementById('edit-hours').value;
    const category = document.getElementById('edit-category').value;

    try {
        const response = await fetch(`${API_BASE}/manage-report?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hours, category })
        });

        if (!response.ok) throw new Error('更新に失敗しました');

        alert('更新しました');
        closeEditModal();
        checkExistingData(); // データ再取得
    } catch (error) {
        console.error('Update error:', error);
        alert(`エラー: ${error.message}`);
    }
}

// グローバル公開
window.handleCheckChange = handleCheckChange;
window.openEditReport = openEditReport;

// 初期化実行
init();
