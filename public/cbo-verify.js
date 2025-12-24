// API Base URL (環境に応じて変更)
const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : '/api';

// DOM要素
const targetMonth = document.getElementById('target-month');
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const uploadBtn = document.getElementById('upload-btn');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const uploadResult = document.getElementById('upload-result');
const verifyBtn = document.getElementById('verify-btn');
const resultSection = document.getElementById('result-section');
const exportBtn = document.getElementById('export-btn');
const newVerifyBtn = document.getElementById('new-verify-btn');

// ページリセット
function resetPage(clearMonth = true) {
    if (clearMonth) {
        location.reload();
        return;
    }

    // 部分リセット（月変更時やデータなしの場合）
    selectedFile = null;
    verificationData = null;
    fileInput.value = '';

    // 表示リセット
    fileInfo.style.display = 'none';
    uploadResult.style.display = 'none';
    resultSection.style.display = 'none';
    uploadArea.classList.remove('drag-over');
    uploadArea.style.display = 'block'; // エリアを再表示
    document.getElementById('upload-section').style.display = 'block';

    // プログレスバーリセット
    progress.style.display = 'none';
    progressBar.style.width = '0%';
}

// グローバル変数
let selectedFile = null;
let verificationData = null;

// 初期化
function init() {
    // デフォルト月を今月に設定
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    targetMonth.value = currentMonth;

    // イベントリスナー
    targetMonth.addEventListener('change', checkExistingData);
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    uploadBtn.addEventListener('click', handleUpload);
    verifyBtn.addEventListener('click', () => handleVerify(false));
    exportBtn.addEventListener('click', handleExport);
    newVerifyBtn.addEventListener('click', () => location.reload());

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

// 既存データのチェック
async function checkExistingData() {
    const month = targetMonth.value;
    if (!month) return;

    try {
        // キャッシュチェック（再検証なし）
        const response = await fetch(`${API_BASE}/verify-cbo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month, force_refresh: false })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.from_cache && result.verification) {
                console.log('Found cached data');
                verificationData = result.verification;
                displayVerificationResult(verificationData, true);

                // アップロードセクションは隠さない（更新用）
                // document.getElementById('upload-section').style.display = 'none';
            } else {
                // データがない場合はアップロード画面に戻る（月変更時など）
                resetPage(false);
            }
        } else {
            resetPage(false);
        }
    } catch (error) {
        console.log('No existing data or error:', error);
        resetPage(false);
    }
}

// ファイル選択
function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
        displayFileInfo(files);
    }
}

// ドラッグオーバー
function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
}

// ドラッグリーブ
function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
}

// ドロップ
function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');

    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'));
    if (files.length > 0) {
        displayFileInfo(files);
    } else {
        alert('CSVファイルを選択してください');
    }
}

// ファイル情報表示
function displayFileInfo(files) {
    selectedFile = files;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    fileName.textContent = files.length === 1
        ? files[0].name
        : `${files.length}個のファイル (${files.map(f => f.name).join(', ')})`;
    fileSize.textContent = formatFileSize(totalSize);
    fileInfo.style.display = 'block';
    uploadArea.style.display = 'none';
}

// ファイルサイズフォーマット
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// CSVアップロード
async function handleUpload() {
    if (!selectedFile || (Array.isArray(selectedFile) && selectedFile.length === 0)) {
        alert('ファイルを選択してください');
        return;
    }

    if (!targetMonth.value) {
        alert('対象月を選択してください');
        return;
    }

    try {
        // プログレス表示
        uploadBtn.disabled = true;
        progress.style.display = 'block';
        progressBar.style.width = '20%';
        progressText.textContent = 'CSVを読み込み中...';

        // 複数ファイルの場合は配列、単一の場合は配列化
        const files = Array.isArray(selectedFile) ? selectedFile : [selectedFile];
        let combinedCSV = '';
        let headerAdded = false;

        // 各CSVを読み込んで統合
        for (let i = 0; i < files.length; i++) {
            const csvContent = await readFileAsText(files[i]);
            const lines = csvContent.split('\n');

            if (!headerAdded) {
                // 最初のファイルはヘッダー込みで追加
                combinedCSV = csvContent;
                headerAdded = true;
            } else {
                // 2番目以降はヘッダーをスキップ
                const dataLines = lines.slice(1).join('\n');
                combinedCSV += '\n' + dataLines;
            }

            progressBar.style.width = `${20 + (20 * (i + 1) / files.length)}%`;
        }

        progressText.textContent = 'データをパース中...';

        // APIにPOST
        const response = await fetch(`${API_BASE}/parse-cbo-csv`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                csvData: combinedCSV,
                month: targetMonth.value
            })
        });

        progressBar.style.width = '80%';

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.details || error.error || 'アップロードに失敗しました');
        }

        const result = await response.json();
        progressBar.style.width = '100%';
        progressText.textContent = '完了！';

        // 結果表示
        setTimeout(() => {
            progress.style.display = 'none';
            fileInfo.style.display = 'none';
            displayUploadResult(result.stats);
        }, 500);

    } catch (error) {
        console.error('Upload error:', error);
        alert(`エラー: ${error.message}`);
        uploadBtn.disabled = false;
        progress.style.display = 'none';
    }
}

// ファイルをテキストとして読み込み
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('ファイルの読み込みに失敗しました'));
        reader.readAsText(file, 'UTF-8');
    });
}

// アップロード結果表示
function displayUploadResult(stats) {
    document.getElementById('total-records').textContent = stats.total_records;
    document.getElementById('total-employees').textContent = stats.employees;
    document.getElementById('date-range').textContent = `${stats.date_range.start} 〜 ${stats.date_range.end}`;
    document.getElementById('total-hours').textContent = `${stats.total_hours} 時間`;
    uploadResult.style.display = 'block';
}

// 検証実行
async function handleVerify(forceRefresh = false) {
    try {
        verifyBtn.disabled = true;
        verifyBtn.textContent = forceRefresh ? '再検証中...' : '検証中...';

        const response = await fetch(`${API_BASE}/verify-cbo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                month: targetMonth.value,
                force_refresh: forceRefresh
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.details || error.error || '検証に失敗しました');
        }

        const result = await response.json();
        verificationData = result.verification;

        // 結果を表示
        displayVerificationResult(verificationData, result.from_cache);

    } catch (error) {
        console.error('Verification error:', error);
        alert(`エラー: ${error.message}`);
        verifyBtn.disabled = false;
        verifyBtn.textContent = '検証を開始';
    }
}

// 再検証実行
function handleReVerify() {
    handleVerify(true);
}
// グローバルスコープに公開（HTMLからの呼び出し用）
window.handleReVerify = handleReVerify;
window.resetPage = resetPage;

// 検証結果表示
function displayVerificationResult(data, fromCache = false) {
    // サマリーカード更新
    document.getElementById('matches-count').textContent = data.summary.matches;
    document.getElementById('missing-count').textContent = data.summary.missing_reports;
    document.getElementById('excess-count').textContent = data.summary.excess_reports;
    document.getElementById('discrepancy-count').textContent = data.summary.time_discrepancies;

    // 未入力日カードを追加
    if (data.missing_days && data.missing_days.missingDays && data.missing_days.missingDays.length > 0) {
        addMissingDaysCard(data.missing_days);
    }

    // キャッシュステータス表示
    displayCacheStatus(fromCache, data.verified_at);

    // 従業員ごとの表示に切り替え
    if (data.by_employee) {
        displayByEmployee(data.by_employee, data.missing_days);
    } else {
        // フォールバック: 従来の表示
        displayDetailList('missing-list', data.details.missing, 'missing');
        displayDetailList('excess-list', data.details.excess, 'excess');
        displayDetailList('discrepancy-list', data.details.discrepancies, 'discrepancy');
        displayDetailList('matches-list', data.details.matches, 'match');
    }

    // デバッグ情報表示
    if (data.debug) {
        displayDebugInfo(data.debug);
    }

    // 結果セクションを表示
    resultSection.style.display = 'block';

    // データがキャッシュからの場合、あるいは新規検証完了時に結果へスクロール
    // ただし、アップロードエリアが上にあるので、少しディレイを入れてスクロールすると親切かも
    setTimeout(() => {
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

// キャッシュステータス表示
function displayCacheStatus(fromCache, verifiedAt) {
    let statusSection = resultSection.querySelector('.cache-status-section');
    if (!statusSection) {
        statusSection = document.createElement('div');
        statusSection.className = 'cache-status-section';
        resultSection.insertBefore(statusSection, resultSection.firstChild);
    }

    const date = new Date(verifiedAt);
    const dateStr = date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    statusSection.innerHTML = `
        <div style="
            background: ${fromCache ? '#EFF6FF' : '#F0FDF4'};
            border: 1px solid ${fromCache ? '#BFDBFE' : '#BBF7D0'};
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        ">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">${fromCache ? '💾' : '✨'}</span>
                <div>
                    <div style="font-weight: 600; color: #1F2937;">
                        ${fromCache ? '保存済みの検証結果を表示中' : '検証完了'}
                    </div>
                    <div style="font-size: 13px; color: #6B7280;">
                        データ日時: ${dateStr}
                    </div>
                </div>
            </div>
            <button 
                onclick="handleReVerify()"
                style="
                    background: #3B82F6;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 14px;
                    cursor: pointer;
                    font-weight: 500;
                "
                onmouseover="this.style.background='#2563EB'"
                onmouseout="this.style.background='#3B82F6'"
            >
                🔄 再検証
            </button>
        </div>
    `;
}

// 未入力日サマリーカードを追加
function addMissingDaysCard(missingDaysInfo) {
    const summaryCardsContainer = document.querySelector('.summary-cards');

    // 既存の未入力日カードを削除
    const existingCard = summaryCardsContainer.querySelector('.missing-days-card');
    if (existingCard) {
        existingCard.remove();
    }

    const missingDayCard = document.createElement('div');
    missingDayCard.className = 'summary-card card-warning missing-days-card';
    missingDayCard.innerHTML = `
        <div class="card-icon">📅</div>
        <div class="card-content">
            <h3>未入力日</h3>
            <p class="card-value">${missingDaysInfo.missingDays.length}</p>
            <p class="card-desc">出勤日で記録漏れあり</p>
        </div>
    `;
    summaryCardsContainer.appendChild(missingDayCard);
}

// 未入力日の詳細セクションを表示
function displayMissingDaysSection(missingDaysInfo) {
    if (!missingDaysInfo || !missingDaysInfo.missingDays || missingDaysInfo.missingDays.length === 0) {
        return '';
    }

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

    let html = `
        <div class="detail-section" style="margin-bottom: 30px;">
            <h3 class="detail-title">📅 未入力日（出勤日で記録漏れあり）</h3>
            <div class="detail-content">
                <div style="background: #FEF3C7; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <p style="margin: 0; color: #92400E; font-size: 14px;">
                        <strong>✨ 休日自動判定:</strong> ${missingDaysInfo.threshold}人未満の記録しかない日は休日として除外しています
                    </p>
                    <p style="margin: 5px 0 0 0; color: #92400E; font-size: 13px;">
                        検出された休日: ${missingDaysInfo.holidays}日 / 対象月の日数: ${missingDaysInfo.totalDays}日 / 出勤日: ${missingDaysInfo.workDays}日
                    </p>
                </div>
    `;

    missingDaysInfo.missingDays.forEach(item => {
        const dayOfWeek = dayNames[item.dayOfWeek];
        const isWeekend = item.dayOfWeek === 0 || item.dayOfWeek === 6;

        html += `
            <div style="
                padding: 12px;
                border-left: 4px solid ${isWeekend ? '#F59E0B' : '#EF4444'};
                background: ${isWeekend ? '#FFFBEB' : '#FEF2F2'};
                margin-bottom: 8px;
                border-radius: 4px;
            ">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <span style="font-weight: 600; color: #1F2937;">${item.date.substring(5)} (${dayOfWeek})</span>
                        ${isWeekend ? '<span style="color: #F59E0B; margin-left: 8px;">⚠️ 土日</span>' : ''}
                    </div>
                    <div style="font-size: 0.9em; color: #6B7280;">
                        記録: ${item.recordCount}人 / 未記録: ${item.missingCount}人
                    </div>
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    return html;
}


// 従業員ごとの表示
function displayByEmployee(byEmployee, missingDaysInfo) {
    // 既存のセクションを非表示
    const missingSec = document.getElementById('missing-section');
    const excessSec = document.getElementById('excess-section');
    const discrepancySec = document.getElementById('discrepancy-section');
    const matchesSec = document.getElementById('matches-section');

    missingSec.style.display = 'none';
    excessSec.style.display = 'none';
    discrepancySec.style.display = 'none';
    matchesSec.style.display = 'none';

    // 新しい表示領域を作成
    let employeeSection = resultSection.querySelector('.employee-grouped-section');
    if (!employeeSection) {
        employeeSection = document.createElement('div');
        employeeSection.className = 'employee-grouped-section';
        resultSection.insertBefore(employeeSection, resultSection.querySelector('.debug-info') || resultSection.firstChild);
    }
    let html = '';
    html += '<h2 style="margin: 20px 0;">メンバー別検証結果</h2>';

    byEmployee.forEach(emp => {
        // 未入力日情報を取得
        const empMissingInfo = missingDaysInfo && missingDaysInfo.byEmployee
            ? missingDaysInfo.byEmployee.find(m => m.employee === emp.employee)
            : null;
        const hasMissingDays = empMissingInfo && empMissingInfo.count > 0;

        const statusClass = (emp.issues > 0 || hasMissingDays) ? 'has-issues' : 'all-good';
        const borderColor = (emp.issues > 0 || hasMissingDays) ? '#EF4444' : '#10B981';

        html += `
            <div class="employee-card ${statusClass}" style="
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
                        ${hasMissingDays ? `<span style="color: #EF4444; font-weight: 600;">❌ 打刻なし${empMissingInfo.count}日</span>` : ''}
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
                'no_punch': '#EF4444' // 赤色で強調
            }[record.status] || '#6B7280';

            let statusText = '';
            if (record.status === 'match') {
                statusText = '一致';
            } else if (record.status === 'discrepancy') {
                statusText = `時間ずれ CBO: ${record.cbo_hours}h / システム: ${record.system_hours}h (差: ${record.difference > 0 ? '+' : ''}${record.difference}h)`;
            } else if (record.status === 'excess') {
                statusText = `過剰報告 CBO: ${record.cbo_hours}h / システム: ${record.system_hours}h`;
            } else if (record.status === 'missing') {
                statusText = `未報告 CBO: ${record.cbo_hours}h / システム: ${record.system_hours}h`;
            } else if (record.status === 'no_punch') {
                statusText = '打刻自体なし（CBO・システムともに記録なし）';
            }

            html += `
                <div class="record-row ${record.status}">
                    <div class="record-main">
                        <div class="record-info">
                            <span class="record-icon">${record.icon}</span>
                            <span class="record-date">${date}</span>
                            <span class="record-status" style="color: ${statusColor};">${statusText}</span>
                        </div>
                        
                        <div class="record-checks">
                            <!-- 本人確認チェック -->
                            <label class="check-label self-check" title="本人確認">
                                <input type="checkbox" 
                                    class="check-box" 
                                    data-month="${verificationData.month}"
                                    data-employee="${emp.employee}"
                                    data-date="${record.date}"
                                    data-type="self"
                                    ${record.self_checked ? 'checked' : ''}
                                    onchange="handleCheckChange(this)">
                                <span>本人</span>
                            </label>
                            
                            <!-- 事務確認チェック -->
                            <label class="check-label admin-check" title="事務確認">
                                <input type="checkbox" 
                                    class="check-box"
                                    data-month="${verificationData.month}"
                                    data-employee="${emp.employee}"
                                    data-date="${record.date}"
                                    data-type="admin"
                                    ${record.admin_checked ? 'checked' : ''}
                                    onchange="handleCheckChange(this)">
                                <span>事務</span>
                            </label>
                        </div>
                    </div>
                    ${renderSystemDetails(record, emp.employee)}
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    employeeSection.innerHTML = html;
}

// デバッグ情報表示
function displayDebugInfo(debug) {
    console.log('=== デバッグ情報 ===');
    console.log('システムレポート総数:', debug.total_system_reports);
    console.log('サンプルレポート1:', debug.sample_system_report);
    console.log('サンプルレポート2:', debug.sample_system_report_2);

    // UIに表示（折りたたみ可能）
    let debugHTML = `
        <div style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 8px; font-size: 14px;">
            <details>
                <summary style="cursor: pointer; font-weight: 600; margin-bottom: 10px;">
                    🔧 デバッグ情報（クリックして展開）
                </summary>
                    <div style="padding: 10px; background: white; border-radius: 4px; font-family: monospace;">
                        <p><strong>システムレポート総数:</strong> ${debug.total_system_reports}件</p>
                        `;

    if (debug.sample_system_report) {
        debugHTML += `
                    <p><strong>サンプルレポート1:</strong></p>
                    <pre style="background: #f0f0f0; padding: 10px; border-radius: 4px; overflow-x: auto;">${JSON.stringify(debug.sample_system_report, null, 2)}</pre>
        `;
    }

    if (debug.sample_system_report_2) {
        debugHTML += `
                    <p><strong>サンプルレポート2:</strong></p>
                    <pre style="background: #f0f0f0; padding: 10px; border-radius: 4px; overflow-x: auto;">${JSON.stringify(debug.sample_system_report_2, null, 2)}</pre>
        `;
    }

    debugHTML += `
                    </div>
            </details>
        </div>
            `;

    // result-section の最後に追加
    const resultSection = document.getElementById('result-section');
    const existingDebug = resultSection.querySelector('.debug-info');
    if (existingDebug) {
        existingDebug.remove();
    }
    const debugDiv = document.createElement('div');
    debugDiv.className = 'debug-info';
    debugDiv.innerHTML = debugHTML;
    resultSection.appendChild(debugDiv);
}

// 詳細リスト表示
function displayDetailList(elementId, items, type) {
    const listElement = document.getElementById(elementId);

    if (items.length === 0) {
        listElement.innerHTML = '<p class="empty-message">該当なし</p>';
        return;
    }

    let html = '';

    items.forEach(item => {
        if (type === 'match') {
            html += `
                <div class="detail-item">
          <span class="date">${item.date}</span>
          <span class="employee">${item.employee}</span>
          <span class="hours">${item.hours}時間</span>
        </div>
            `;
        } else if (type === 'discrepancy') {
            html += `
            <div class="detail-item ${type}">
          <span class="date">${item.date}</span>
          <span class="employee">${item.employee}</span>
          <span class="hours">
            CBO: ${item.cbo_hours}h / システム: ${item.system_hours}h 
            (差: ${item.difference > 0 ? '+' : ''}${item.difference}h)
          </span>
        </div>
            `;
        } else {
            html += `
            <div class="detail-item ${type}">
          <span class="date">${item.date}</span>
          <span class="employee">${item.employee}</span>
          <span class="hours">
            CBO: ${item.cbo_hours}h / システム: ${item.system_hours}h
          </span>
        </div>
            `;
        }
    });

    listElement.innerHTML = html;
}

// CSV出力
function handleExport() {
    if (!verificationData) {
        alert('検証データがありません');
        return;
    }

    let csv = '検証結果,日付,従業員,CBO時間,システム時間,差異\n';

    // 未報告
    verificationData.details.missing.forEach(item => {
        csv += `未報告, ${item.date},${item.employee},${item.cbo_hours},${item.system_hours}, -\n`;
    });

    // 過剰報告
    verificationData.details.excess.forEach(item => {
        csv += `過剰報告, ${item.date},${item.employee},${item.cbo_hours},${item.system_hours}, -\n`;
    });

    // 時間ずれ
    verificationData.details.discrepancies.forEach(item => {
        csv += `時間ずれ, ${item.date},${item.employee},${item.cbo_hours},${item.system_hours},${item.difference} \n`;
    });

    // ダウンロード
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `verification_result_${targetMonth.value}.csv`;
    link.click();
}



// ---------------------------------------------------------
// Edit / Delete Functions
// ---------------------------------------------------------

// システム詳細（編集用ボタン付き）のレンダリング
function renderSystemDetails(record, employeeName) {
    if (!record.system_details || record.system_details.length === 0) return '';

    // システム報告に関連するレコードのみ詳細を表示
    // missing (CBOあり、システムなし) の場合は詳細は空のはずだが、もしあれば表示

    let html = '<div class="system-details-list">';
    html += record.system_details.map(detail => `
            <div class="system-detail-item">
            <span style="color: #666; font-size: 0.9em;">
                📝 システム報告: <strong>${detail.category}</strong> ${detail.hours}h
            </span>
            <div class="report-actions">
                <button class="btn-sm btn-edit" onclick="openEditReport('${detail.id}', '${record.date}', '${employeeName}', '${detail.category}', ${detail.hours})">編集</button>
                <button class="btn-sm btn-delete" onclick="deleteReport('${detail.id}')">削除</button>
            </div>
        </div>
            `).join('');
    html += '</div>';
    return html;
}

// 削除処理
async function deleteReport(reportId) {
    if (!confirm('本当にこの報告を削除しますか？\nこの操作は取り消せません。')) return;

    try {
        const response = await fetch(`${API_BASE}/manage-report?id=${reportId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '削除に失敗しました');
        }

        alert('削除しました');
        // 再検証（強制リフレッシュ）
        handleVerify(true);

    } catch (error) {
        console.error('Delete error:', error);
        alert(`エラー: ${error.message}`);
    }
}

// 編集モーダルを開く
function openEditReport(id, date, employee, category, hours) {
    document.getElementById('edit-report-id').value = id;
    document.getElementById('edit-date').value = date;
    document.getElementById('edit-employee').value = employee;
    document.getElementById('edit-category').value = category;
    document.getElementById('edit-hours').value = hours;

    document.getElementById('edit-modal').style.display = 'flex';
}

// 編集モーダルを閉じる
function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

// 編集保存処理
async function handleEditSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('edit-report-id').value;
    const hours = document.getElementById('edit-hours').value;
    const category = document.getElementById('edit-category').value;
    const date = document.getElementById('edit-date').value.replace(/\//g, '-'); // YYYY/MM/DD -> YYYY-MM-DD

    try {
        const response = await fetch(`${API_BASE}/manage-report?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hours,
                category,
                date: date // 日付変更は今回はUIでdisableにしているがAPIは対応済み
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '更新に失敗しました');
        }

        alert('更新しました');
        closeEditModal();
        // 再検証
        handleVerify(true);

    } catch (error) {
        console.error('Update error:', error);
        alert(`エラー: ${error.message}`);
    }
}

// ---------------------------------------------------------
// Check Change Handler
// ---------------------------------------------------------

/**
 * チェックボックスの状態変更ハンドラー
 */
async function handleCheckChange(checkbox) {
    const month = checkbox.dataset.month;
    const employee = checkbox.dataset.employee;
    const date = checkbox.dataset.date;
    const checkType = checkbox.dataset.type;
    const checked = checkbox.checked;

    try {
        // チェックボックスを一時的に無効化
        checkbox.disabled = true;

        const response = await fetch(`${API_BASE}/update-verification-check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                month,
                employee,
                date,
                checkType,
                checked
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.details || error.error || 'チェック状態の更新に失敗しました');
        }

        const result = await response.json();
        console.log('Check updated:', result);

        // 成功時の視覚的フィードバック
        checkbox.parentElement.classList.add('check-updated');
        setTimeout(() => {
            checkbox.parentElement.classList.remove('check-updated');
        }, 500);

    } catch (error) {
        console.error('Error updating check:', error);
        alert(`エラー: ${error.message}`);
        // エラー時は元に戻す
        checkbox.checked = !checked;
    } finally {
        checkbox.disabled = false;
    }
}

// グローバル公開
window.deleteReport = deleteReport;
window.openEditReport = openEditReport;
window.handleCheckChange = handleCheckChange;

// 初期化実行
init();
