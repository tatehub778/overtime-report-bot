// ファイル管理
const files = {
    office: null,
    attendance: null,
    cbo: null
};

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    // アップロードボックスの設定
    document.querySelectorAll('.upload-box').forEach(box => {
        const input = box.querySelector('input[type="file"]');
        const type = box.dataset.type;

        box.addEventListener('click', () => input.click());

        box.addEventListener('dragover', e => {
            e.preventDefault();
            box.style.borderColor = '#3b82f6';
        });

        box.addEventListener('dragleave', () => {
            box.style.borderColor = files[type] ? '#10b981' : '#cbd5e1';
        });

        box.addEventListener('drop', e => {
            e.preventDefault();
            if (e.dataTransfer.files.length) {
                handleFile(type, e.dataTransfer.files[0], box);
            }
        });

        input.addEventListener('change', e => {
            if (e.target.files.length) {
                handleFile(type, e.target.files[0], box);
            }
        });
    });

    // 分析ボタン
    document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
});

function handleFile(type, file, box) {
    files[type] = file;
    box.classList.add('has-file');
    box.querySelector('.file-name').textContent = file.name;

    // 1つでもファイルがあれば分析可能
    const btn = document.getElementById('analyzeBtn');
    btn.disabled = !Object.values(files).some(f => f !== null);
}

async function runAnalysis() {
    const btn = document.getElementById('analyzeBtn');
    btn.disabled = true;
    btn.textContent = '分析中...';

    try {
        // ファイル読み込み
        const data = {};
        if (files.office) data.officeCsv = await readFile(files.office);
        if (files.attendance) data.attendanceCsv = await readFile(files.attendance);
        if (files.cbo) data.cboCsv = await readFile(files.cbo);

        // API呼び出し
        const response = await fetch('/api/analyze-work-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.details || err.error || 'API Error');
        }

        const result = await response.json();
        renderResults(result);

        document.getElementById('resultsSection').style.display = 'block';

    } catch (error) {
        console.error(error);
        alert('エラー: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 分析実行';
    }
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file, 'Shift_JIS');
    });
}

function renderResults(result) {
    const { summary, officeDetails } = result;

    // アップロードされたファイルの種類を確認
    const hasOffice = files.office !== null;
    const hasCbo = files.cbo !== null;
    const hasAttendance = files.attendance !== null;

    // サマリーカード
    const totals = summary.reduce((acc, emp) => {
        acc.regularTotal += emp.regularTotal;
        acc.regularField += emp.regularField;
        acc.overtimeTotal += emp.overtimeTotal;
        acc.overtimeField += emp.overtimeField;
        acc.officeOvertimeHours += emp.officeOvertimeHours;
        return acc;
    }, { regularTotal: 0, regularField: 0, overtimeTotal: 0, overtimeField: 0, officeOvertimeHours: 0 });

    // 事務残業CSV単独の場合はシンプル表示
    if (hasOffice && !hasCbo && !hasAttendance) {
        document.getElementById('summaryCards').innerHTML = `
            <div class="summary-card">
                <h4>集計人数</h4>
                <div class="value">${summary.length}名</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #3b82f6;">
                <h4>総事務残業時間</h4>
                <div class="value" style="color:#2563eb;">${totals.officeOvertimeHours.toFixed(1)}h</div>
            </div>
        `;

        // シンプルなサマリーテーブル
        const tbody = document.querySelector('#mainTable tbody');
        const thead = document.querySelector('#mainTable thead');

        thead.innerHTML = `
            <tr>
                <th>氏名</th>
                <th class="numeric">事務残業時間(h)</th>
            </tr>
        `;

        tbody.innerHTML = summary
            .filter(emp => emp.officeOvertimeHours > 0)
            .sort((a, b) => b.officeOvertimeHours - a.officeOvertimeHours)
            .map(emp => `
                <tr>
                    <td><strong>${emp.name}</strong></td>
                    <td class="numeric" style="color:#2563eb; font-weight:bold;">${emp.officeOvertimeHours.toFixed(1)}</td>
                </tr>
            `).join('');

    } else {
        // 詳細表示（CBO日報などがある場合）
        document.getElementById('summaryCards').innerHTML = `
            <div class="summary-card">
                <h4>集計人数</h4>
                <div class="value">${summary.length}名</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #10b981;">
                <h4>定時内現場時間</h4>
                <div class="value" style="color:#059669;">${totals.regularField.toFixed(1)}h</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #f59e0b;">
                <h4>残業現場時間</h4>
                <div class="value" style="color:#d97706;">${totals.overtimeField.toFixed(1)}h</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #3b82f6;">
                <h4>事務残業時間</h4>
                <div class="value" style="color:#2563eb;">${totals.officeOvertimeHours.toFixed(1)}h</div>
            </div>
        `;

        const tbody = document.querySelector('#mainTable tbody');
        const thead = document.querySelector('#mainTable thead');

        thead.innerHTML = `
            <tr>
                <th>氏名</th>
                <th class="numeric">定時内合計</th>
                <th class="numeric">定時内現場</th>
                <th class="numeric">定時内事務等</th>
                <th class="numeric">残業合計</th>
                <th class="numeric">残業現場</th>
                <th class="numeric">残業事務等</th>
                <th>内訳</th>
            </tr>
        `;

        tbody.innerHTML = summary.map(emp => {
            const regularPct = emp.regularTotal > 0 ? (emp.regularField / emp.regularTotal * 100) : 0;
            const otPct = emp.overtimeTotal > 0 ? (emp.overtimeField / emp.overtimeTotal * 100) : 0;

            return `
                <tr>
                    <td><strong>${emp.name}</strong></td>
                    <td class="numeric">${emp.regularTotal.toFixed(1)}</td>
                    <td class="numeric" style="color:#059669;">${emp.regularField.toFixed(1)}</td>
                    <td class="numeric">${emp.regularOffice.toFixed(1)}</td>
                    <td class="numeric">${emp.overtimeTotal.toFixed(1)}</td>
                    <td class="numeric" style="color:#d97706;">${emp.overtimeField.toFixed(1)}</td>
                    <td class="numeric">${emp.overtimeOffice.toFixed(1)}</td>
                    <td>
                        <div class="bar-container" title="定時:現場${regularPct.toFixed(0)}%, 残業:現場${otPct.toFixed(0)}%">
                            <div class="bar-field" style="width:${regularPct / 2}%;"></div>
                            <div class="bar-office" style="width:${otPct / 2}%;"></div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // 詳細テーブル（事務残業）
    const detailsSection = document.getElementById('detailsSection');
    const detailsTbody = document.querySelector('#detailsTable tbody');

    if (officeDetails && officeDetails.length > 0) {
        detailsSection.style.display = 'block';

        // 日付でソート（降順）
        officeDetails.sort((a, b) => b.date.localeCompare(a.date));

        detailsTbody.innerHTML = officeDetails.map(d => `
            <tr>
                <td>${d.date}</td>
                <td><strong>${d.name}</strong></td>
                <td>${d.project}</td>
                <td>${d.task}</td>
                <td class="numeric">${d.hours.toFixed(1)}</td>
            </tr>
        `).join('');
    } else {
        detailsSection.style.display = 'none';
    }
}
