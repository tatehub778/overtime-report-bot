// DOM Elements
const cboUploadArea = document.getElementById('cboUploadArea');
const cboInput = document.getElementById('cboInput');
const cboFileName = document.getElementById('cboFileName');

const attUploadArea = document.getElementById('attUploadArea');
const attInput = document.getElementById('attInput');
const attFileName = document.getElementById('attFileName');

const analyzeBtn = document.getElementById('analyzeBtn');
const dashboardContent = document.getElementById('dashboardContent');

// State
let cboFile = null;
let attFile = null;

// Initialize
function init() {
    setupUploadHandler(cboUploadArea, cboInput, (file) => {
        cboFile = file;
        cboFileName.textContent = file.name;
        cboUploadArea.classList.add('has-file'); // You might need CSS for this or just rely on text
        checkReady();
    });

    setupUploadHandler(attUploadArea, attInput, (file) => {
        attFile = file;
        attFileName.textContent = file.name;
        attUploadArea.classList.add('has-file');
        checkReady();
    });

    analyzeBtn.addEventListener('click', handleAnalyze);
}

function setupUploadHandler(area, input, onFileSelect) {
    if (!area) return;

    area.addEventListener('click', () => input.click());
    area.addEventListener('dragover', (e) => {
        e.preventDefault();
        area.style.backgroundColor = '#f0f9ff';
        area.style.borderColor = '#0ea5e9';
    });
    area.addEventListener('dragleave', () => {
        area.style.backgroundColor = '';
        area.style.borderColor = '';
    });
    area.addEventListener('drop', (e) => {
        e.preventDefault();
        area.style.backgroundColor = '';
        area.style.borderColor = '';
        if (e.dataTransfer.files.length) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    });
    input.addEventListener('change', (e) => {
        if (e.target.files.length) {
            onFileSelect(e.target.files[0]);
        }
    });
}

function checkReady() {
    if (cboFile && attFile) {
        analyzeBtn.style.display = 'inline-block';
    }
}

async function handleAnalyze() {
    if (!cboFile || !attFile) return;

    analyzeBtn.textContent = '計算中...';
    analyzeBtn.disabled = true;

    try {
        // Read files (Shift-JIS to UTF-8)
        const cboText = await readFile(cboFile);
        const attText = await readFile(attFile);

        // Call API
        const response = await fetch('/api/analyze-work-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cboCsv: cboText, attendanceCsv: attText })
        });

        if (!response.ok) throw new Error('API Error');
        const data = await response.json();

        // Render Dashboard
        renderDashboard(data.summary);

        dashboardContent.style.display = 'block';
        analyzeBtn.textContent = '🚀 分析実行';
        analyzeBtn.disabled = false;

    } catch (error) {
        console.error(error);
        alert('エラーが発生しました: ' + error.message);
        analyzeBtn.textContent = '🚀 分析実行';
        analyzeBtn.disabled = false;
    }
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        // Shift-JISとして読み込む
        reader.readAsText(file, 'Shift_JIS');
    });
}

function renderDashboard(summary) {
    const tableBody = document.querySelector('#analysisTable tbody');
    const tableHead = document.querySelector('#analysisTable thead');

    // Headers
    tableHead.innerHTML = `
        <tr>
            <th>氏名</th>
            <th class="numeric">① 定時内現場 (h)</th>
            <th class="numeric">② 事務残業 (h)</th>
            <th class="numeric">③ その他残業 (h)</th>
            <th class="numeric">合計残業 (②+③)</th>
            <th style="width: 30%;">内訳 (割合)</th>
        </tr>
    `;

    // Body
    if (summary.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">該当データなし</td></tr>';
    } else {
        tableBody.innerHTML = summary.map(row => {
            // バーの計算 (%)
            // 分母は (定時内現場 + 合計残業) で「総労働時間のうちの当該部分」とするか
            // User wants "Visualized what they are spending hours on".
            const total = row.fieldWorkRegular + row.officeOvertime + row.otherOvertime;

            let fieldPct = 0, officeOtPct = 0, otherOtPct = 0;
            if (total > 0) {
                fieldPct = (row.fieldWorkRegular / total) * 100;
                officeOtPct = (row.officeOvertime / total) * 100;
                otherOtPct = (row.otherOvertime / total) * 100;
            }

            return `
                <tr>
                    <td style="font-weight: bold;">${row.name}</td>
                    <td class="numeric" style="color: #059669; font-weight:bold;">${row.fieldWorkRegular.toFixed(1)}</td>
                    <td class="numeric" style="color: #D97706;">${row.officeOvertime.toFixed(1)}</td>
                    <td class="numeric" style="color: #DC2626;">${row.otherOvertime.toFixed(1)}</td>
                    <td class="numeric" style="font-weight: bold;">${row.totalOvertime.toFixed(1)}</td>
                    <td>
                        <div style="display: flex; height: 24px; background: #f3f4f6; border-radius: 4px; overflow: hidden; width: 100%;">
                            ${fieldPct > 0 ? `<div style="width: ${fieldPct}%; background: #10B981;" title="定時内現場: ${row.fieldWorkRegular}h"></div>` : ''}
                            ${officeOtPct > 0 ? `<div style="width: ${officeOtPct}%; background: #F59E0B;" title="事務残業: ${row.officeOvertime}h"></div>` : ''}
                            ${otherOtPct > 0 ? `<div style="width: ${otherOtPct}%; background: #EF4444;" title="その他残業: ${row.otherOvertime}h"></div>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }


    // Render Details Table (Office Overtime Details)
    const detailsBody = document.querySelector('#detailsTable tbody');
    if (detailsBody) {
        let allDetails = [];
        summary.forEach(emp => {
            if (emp.details && emp.details.length > 0) {
                emp.details.forEach(d => {
                    allDetails.push({ ...d, name: emp.name });
                });
            }
        });

        // Sort by Date, then Name
        allDetails.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

        if (allDetails.length === 0) {
            detailsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">事務残業の詳細データなし</td></tr>';
        } else {
            detailsBody.innerHTML = allDetails.map(d => `
                <tr>
                    <td>${d.date}</td>
                    <td style="font-weight: bold;">${d.name}</td>
                    <td>${d.project}</td>
                    <td>${d.task}</td>
                    <td class="numeric">${d.hours.toFixed(1)}</td>
                </tr>
            `).join('');
        }
    }

    // Show details section
    const detSec = document.querySelector('.details-section');
    if (detSec) detSec.style.display = 'block';

    // Update summary cards
    const totalField = summary.reduce((sum, r) => sum + r.fieldWorkRegular, 0);
    const totalOfficeOt = summary.reduce((sum, r) => sum + r.officeOvertime, 0);
    const totalOtherOt = summary.reduce((sum, r) => sum + r.otherOvertime, 0);

    const summaryHtml = `
        <div class="summary-card">
            <h3>集計人数</h3>
            <div class="value">${summary.length}名</div>
        </div>
        <div class="summary-card" style="border-top: 4px solid #10B981;">
            <h3>定時内現場</h3>
            <div class="value" style="color: #059669;">${totalField.toFixed(1)}h</div>
        </div>
        <div class="summary-card" style="border-top: 4px solid #F59E0B;">
            <h3>事務残業</h3>
            <div class="value" style="color: #D97706;">${totalOfficeOt.toFixed(1)}h</div>
        </div>
        <div class="summary-card" style="border-top: 4px solid #EF4444;">
            <h3>その他残業</h3>
            <div class="value" style="color: #DC2626;">${totalOtherOt.toFixed(1)}h</div>
        </div>
    `;

    const cardContainer = document.querySelector('.summary-cards');
    if (cardContainer) cardContainer.innerHTML = summaryHtml;
}

init();
