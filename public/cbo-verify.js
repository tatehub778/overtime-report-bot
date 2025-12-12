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
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    uploadBtn.addEventListener('click', handleUpload);
    verifyBtn.addEventListener('click', handleVerify);
    exportBtn.addEventListener('click', handleExport);
    newVerifyBtn.addEventListener('click', resetPage);
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
async function handleVerify() {
    try {
        verifyBtn.disabled = true;
        verifyBtn.textContent = '検証中...';

        const response = await fetch(`${API_BASE}/verify-cbo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                month: targetMonth.value
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.details || error.error || '検証に失敗しました');
        }

        const result = await response.json();
        verificationData = result.verification;

        // 結果を表示
        displayVerificationResult(verificationData);

    } catch (error) {
        console.error('Verification error:', error);
        alert(`エラー: ${error.message}`);
        verifyBtn.disabled = false;
        verifyBtn.textContent = '検証を開始';
    }
}

// 検証結果表示
function displayVerificationResult(data) {
    // サマリーカード更新
    document.getElementById('matches-count').textContent = data.summary.matches;
    document.getElementById('missing-count').textContent = data.summary.missing_reports;
    document.getElementById('excess-count').textContent = data.summary.excess_reports;
    document.getElementById('discrepancy-count').textContent = data.summary.time_discrepancies;

    // 従業員ごとの表示に切り替え
    if (data.by_employee) {
        displayByEmployee(data.by_employee);
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
    resultSection.scrollIntoView({ behavior: 'smooth' });
}

// 従業員ごとの表示
function displayByEmployee(byEmployee) {
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

    let html = '<h2 style="margin: 20px 0;">従業員別検証結果</h2>';

    byEmployee.forEach(emp => {
        const statusClass = emp.issues > 0 ? 'has-issues' : 'all-good';
        html += `
            <div class="employee-card ${statusClass}" style="
                margin: 15px 0;
                padding: 15px;
                border-radius: 8px;
                background: white;
                border-left: 4px solid ${emp.issues > 0 ? '#EF4444' : '#10B981'};
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
                'missing': '#F59E0B'
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
            }

            html += `
                <div style="
                    padding: 8px 0;
                    border-bottom: 1px dashed #E5E7EB;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                ">
                    <span style="font-size: 20px;">${record.icon}</span>
                    <span style="min-width: 50px; font-weight: 500; color: #6B7280;">${date}</span>
                    <span style="color: ${statusColor}; flex: 1;">${statusText}</span>
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
        csv += `未報告,${item.date},${item.employee},${item.cbo_hours},${item.system_hours},-\n`;
    });

    // 過剰報告
    verificationData.details.excess.forEach(item => {
        csv += `過剰報告,${item.date},${item.employee},${item.cbo_hours},${item.system_hours},-\n`;
    });

    // 時間ずれ
    verificationData.details.discrepancies.forEach(item => {
        csv += `時間ずれ,${item.date},${item.employee},${item.cbo_hours},${item.system_hours},${item.difference}\n`;
    });

    // ダウンロード
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `verification_result_${targetMonth.value}.csv`;
    link.click();
}

// ページリセット
function resetPage() {
    location.reload();
}

// 初期化実行
init();
