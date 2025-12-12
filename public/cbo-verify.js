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
    const file = e.target.files[0];
    if (file) {
        displayFileInfo(file);
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

    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
        displayFileInfo(file);
    } else {
        alert('CSVファイルを選択してください');
    }
}

// ファイル情報表示
function displayFileInfo(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
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
    if (!selectedFile) {
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

        // CSVファイルを読み込み
        const csvData = await readFileAsText(selectedFile);
        progressBar.style.width = '40%';
        progressText.textContent = 'データをパース中...';

        // APIにPOST
        const response = await fetch(`${API_BASE}/parse-cbo-csv`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                csvData,
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

    // 詳細リスト表示
    displayDetailList('missing-list', data.details.missing, 'missing');
    displayDetailList('excess-list', data.details.excess, 'excess');
    displayDetailList('discrepancy-list', data.details.discrepancies, 'discrepancy');
    displayDetailList('matches-list', data.details.matches, 'match');

    // セクション表示順調整（問題があるものを上に）
    const missingSec = document.getElementById('missing-section');
    const excessSec = document.getElementById('excess-section');
    const discrepancySec = document.getElementById('discrepancy-section');
    const matchesSec = document.getElementById('matches-section');

    if (data.summary.missing_reports === 0) missingSec.style.display = 'none';
    if (data.summary.excess_reports === 0) excessSec.style.display = 'none';
    if (data.summary.time_discrepancies === 0) discrepancySec.style.display = 'none';

    // 結果セクションを表示
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth' });
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
