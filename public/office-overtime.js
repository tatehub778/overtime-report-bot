// ファイル管理
const files = {
    office: null,
    attendance: null,
    cbo: null,
    sales: null
};

// 期間フィルター
let currentPeriod = 'all'; // 'all', 'YYYY-MM', 'FY-YYYY'
let analysisData = null; // 元データを保持

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    // アップロードボックスの設定
    ['office', 'attendance', 'cbo', 'sales'].forEach(type => {
        const box = document.getElementById(`upload${type.charAt(0).toUpperCase() + type.slice(1)}`);
        const input = box.querySelector('input');

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
    const resultsSection = document.getElementById('resultsSection');
    btn.disabled = true;
    btn.textContent = '⏳ 分析中...';

    try {
        const payload = {
            officeCsv: files.office ? await readFile(files.office) : null,
            attendanceCsv: files.attendance ? await readFile(files.attendance) : null,
            cboReportCsv: files.cbo ? await readFile(files.cbo) : null,
            salesCsv: files.sales ? await readFile(files.sales) : null // 販売CSV追加
        };

        const response = await fetch('/api/analyze-work-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.error) {
            alert('エラー: ' + result.error);
            return;
        }

        analysisData = result; // フィルタリング用に保存

        // 期間フィルターの作成 (CBO詳細がある場合)
        if (result.cboDetails && result.cboDetails.length > 0) {
            createPeriodFilter(result.cboDetails);
        } else {
            // CBO詳細がない場合は期間フィルターを削除または非表示
            const existingFilter = resultsSection.querySelector('.period-filter');
            if (existingFilter) existingFilter.remove();
        }

        // 初期表示（全期間）
        currentPeriod = 'all';
        renderResults(result);
        resultsSection.style.display = 'block';

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

function createPeriodFilter(details) {
    if (!details || details.length === 0) return;

    // 日付から年月を抽出
    const months = new Set();
    const fiscalYears = new Set();

    details.forEach(d => {
        const dateStr = d.date; // "2025年12月10日"
        const match = dateStr.match(/(\d{4})年(\d{1,2})月/);
        if (match) {
            const year = parseInt(match[1]);
            const month = parseInt(match[2]);
            months.add(`${year} -${String(month).padStart(2, '0')} `);

            // 年度計算（4月始まり）
            const fy = month >= 4 ? year : year - 1;
            fiscalYears.add(`FY - ${fy} `);
        }
    });

    // フィルターUI作成
    const filterHtml = `
    < div class="period-filter" style = "margin-bottom: 20px; text-align: center;" >
            <label style="margin-right: 10px; font-weight: bold;">期間:</label>
            <select id="periodSelect" style="padding: 8px 15px; border-radius: 6px; border: 1px solid #cbd5e1;">
                <option value="all">全期間</option>
                ${Array.from(months).sort().reverse().map(m =>
        `<option value="${m}">${m.replace('-', '年')}月</option>`
    ).join('')}
                ${Array.from(fiscalYears).sort().reverse().map(fy => {
        const year = parseInt(fy.split('-')[1]);
        return `<option value="${fy}">${year}年度 (${year}/4～${year + 1}/3)</option>`;
    }).join('')}
            </select>
        </div >
    `;

    const resultsSection = document.getElementById('resultsSection');
    const existing = resultsSection.querySelector('.period-filter');
    if (existing) existing.remove();

    resultsSection.insertAdjacentHTML('afterbegin', filterHtml);

    document.getElementById('periodSelect').addEventListener('change', (e) => {
        currentPeriod = e.target.value;
        renderResults(analysisData);
    });
}

function filterByPeriod(details) {
    if (currentPeriod === 'all') return details;

    return details.filter(d => {
        const match = d.date.match(/(\d{4})年(\d{1,2})月/);
        if (!match) return false;

        const year = parseInt(match[1]);
        const month = parseInt(match[2]);

        if (currentPeriod.startsWith('FY-')) {
            const fy = parseInt(currentPeriod.split('-')[1]);
            const itemFy = month >= 4 ? year : year - 1;
            return itemFy === fy;
        } else {
            const periodYM = `${year} -${String(month).padStart(2, '0')} `;
            return periodYM === currentPeriod;
        }
    });
}

function renderResults(result) {
    const { summary, officeDetails } = result;

    // 期間フィルター適用
    const filteredDetails = filterByPeriod(officeDetails || []);

    // フィルター後の集計
    const filteredSummary = summary.map(emp => {
        const empDetails = filteredDetails.filter(d => d.name === emp.name);
        const totalHours = empDetails.reduce((sum, d) => sum + d.hours, 0);

        // カテゴリ別集計
        const categories = {};
        empDetails.forEach(d => {
            categories[d.category] = (categories[d.category] || 0) + d.hours;
        });

        return {
            ...emp,
            officeOvertimeHours: totalHours,
            taskCategories: categories
        };
    }).filter(emp => emp.officeOvertimeHours > 0);

    // アップロードされたファイルの種類を確認
    const hasOffice = files.office !== null;
    const hasCbo = files.cbo !== null;
    const hasAttendance = files.attendance !== null;

    // サマリーカード
    const totals = filteredSummary.reduce((acc, emp) => {
        acc.officeOvertimeHours += emp.officeOvertimeHours;
        return acc;
    }, { officeOvertimeHours: 0 });

    // 事務残業CSV単独の場合はシンプル表示
    if (hasOffice && !hasCbo && !hasAttendance) {
        // カテゴリ別合計
        const categoryTotals = {};
        filteredSummary.forEach(emp => {
            Object.entries(emp.taskCategories || {}).forEach(([cat, hours]) => {
                categoryTotals[cat] = (categoryTotals[cat] || 0) + hours;
            });
        });

        const categoryCards = Object.entries(categoryTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, hours]) => `
            <div class="summary-card" style="border-top: 3px solid #8b5cf6;">
                <h4>${cat}</h4>
                <div class="value" style="color:#7c3aed; font-size:20px;">${hours.toFixed(1)}h</div>
            </div>
            `).join('');

        document.getElementById('summaryCards').innerHTML = `
            <div class="summary-card">
                <h4>集計人数</h4>
                <div class="value">${filteredSummary.length}名</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #3b82f6;">
                <h4>総事務残業時間</h4>
                <div class="value" style="color:#2563eb;">${totals.officeOvertimeHours.toFixed(1)}h</div>
            </div>
            ${categoryCards}
        `;

        // シンプルなサマリーテーブル
        const tbody = document.querySelector('#mainTable tbody');
        const thead = document.querySelector('#mainTable thead');

        // カテゴリ列を動的生成
        const allCategories = new Set();
        filteredSummary.forEach(emp => {
            Object.keys(emp.taskCategories || {}).forEach(cat => allCategories.add(cat));
        });
        const categoryList = Array.from(allCategories).sort();

        thead.innerHTML = `
            <tr>
                <th>氏名</th>
                <th class="numeric">合計(h)</th>
                ${categoryList.map(cat => `<th class="numeric">${cat}(h)</th>`).join('')}
            </tr>
        `;

        tbody.innerHTML = filteredSummary
            .sort((a, b) => b.officeOvertimeHours - a.officeOvertimeHours)
            .map(emp => `
            <tr>
                <td><strong>${emp.name}</strong></td>
                <td class="numeric" style="color:#2563eb; font-weight:bold;">${emp.officeOvertimeHours.toFixed(1)}</td>
                ${categoryList.map(cat =>
                `<td class="numeric">${(emp.taskCategories[cat] || 0).toFixed(1)}</td>`
            ).join('')}
            </tr>
            `).join('');

    } else {
        // 詳細表示（CBO日報・出勤簿がある場合）
        // 期間フィルター適用
        const filteredCboDetails = filterByPeriod(result.cboDetails || []);

        // フィルタ後のデータからサマリーを再計算
        const employeeMap = new Map();

        filteredCboDetails.forEach(d => {
            if (!employeeMap.has(d.name)) {
                employeeMap.set(d.name, {
                    name: d.name,
                    regularTotal: 0,
                    regularField: 0,
                    overtimeTotal: 0,
                    overtimeField: 0,
                    holidayWorkHours: 0
                });
            }
            const emp = employeeMap.get(d.name);
            emp.regularTotal += d.regularTotal;
            emp.regularField += d.regularField;
            emp.overtimeTotal += d.overtimeTotal;
            emp.overtimeField += d.overtimeField;
            emp.holidayWorkHours += (d.holidayWorkHours || 0);
        });

        // 配列に変換（元々のsummaryと同じ形式）
        const filteredSummaryCbo = Array.from(employeeMap.values()).map(emp => ({
            ...emp,
            regularOffice: emp.regularTotal - emp.regularField,
            overtimeOffice: emp.overtimeTotal - emp.overtimeField
        }));

        // ソート（残業時間合計の降順など、元のロジックに合わせる推奨）
        // ここでは名前順あるいは残業時間順などでソート
        filteredSummaryCbo.sort((a, b) => b.overtimeTotal - a.overtimeTotal);

        const totalsAll = filteredSummaryCbo.reduce((acc, emp) => {
            acc.regularTotal += emp.regularTotal;
            acc.regularField += emp.regularField;
            acc.overtimeTotal += emp.overtimeTotal;
            acc.overtimeField += emp.overtimeField;
            // officeOvertimeHoursは (overtimeTotal - overtimeField) で算出
            return acc;
        }, { regularTotal: 0, regularField: 0, overtimeTotal: 0, overtimeField: 0 });

        const totalHoliday = filteredSummaryCbo.reduce((sum, emp) => sum + emp.holidayWorkHours, 0);

        document.getElementById('summaryCards').innerHTML = `
            <div class="summary-card">
                <h4>集計人数</h4>
                <div class="value">${filteredSummaryCbo.length}名</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #10b981;">
                <h4>定時内現場時間</h4>
                <div class="value" style="color:#059669;">${totalsAll.regularField.toFixed(1)}h</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #f59e0b;">
                <h4>残業現場時間</h4>
                <div class="value" style="color:#d97706;">${totalsAll.overtimeField.toFixed(1)}h</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #3b82f6;">
                <h4>事務残業時間</h4>
                <div class="value" style="color:#2563eb;">${(totalsAll.overtimeTotal - totalsAll.overtimeField).toFixed(1)}h</div>
            </div>
            <div class="summary-card" style="border-top: 4px solid #ef4444;">
                <h4>休日出勤時間</h4>
                <div class="value" style="color:#dc2626;">${totalHoliday.toFixed(1)}h</div>
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
                <th class="numeric">売上高</th>
                <th>内訳</th>
            </tr>
        `;

        tbody.innerHTML = ''; // Clear existing rows
        filteredSummaryCbo.forEach(stat => {
            // 売上高の算出
            let salesAmount = 0;
            const emp = Object.values(result.employees).find(e => e.name === stat.name);
            if (emp && emp.salesMap) {
                if (currentPeriod === 'all') {
                    salesAmount = Object.values(emp.salesMap).reduce((a, b) => a + b, 0);
                } else {
                    const periodKey = currentPeriod.replace('-', '/');
                    salesAmount = emp.salesMap[periodKey] || 0;
                }
            }

            const regularPct = stat.regularTotal > 0 ? (stat.regularField / stat.regularTotal * 100) : 0;
            const otPct = stat.overtimeTotal > 0 ? (stat.overtimeField / stat.overtimeTotal * 100) : 0;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${stat.name}</strong></td>
                <td class="numeric">${stat.regularTotal.toFixed(1)}</td>
                <td class="numeric" style="color:#059669;">${stat.regularField.toFixed(1)}</td>
                <td class="numeric">${stat.regularOffice.toFixed(1)}</td>
                <td class="numeric">${stat.overtimeTotal.toFixed(1)}</td>
                <td class="numeric" style="color:#d97706;">${stat.overtimeField.toFixed(1)}</td>
                <td class="numeric">${stat.overtimeOffice.toFixed(1)}</td>
                <td class="numeric" style="color:#2563eb; font-weight:bold">¥${salesAmount.toLocaleString()}</td>
                <td>
                    <div class="bar-container" title="定時:現場${regularPct.toFixed(0)}%, 残業:現場${otPct.toFixed(0)}%">
                        <div class="bar-field" style="width:${regularPct / 2}%;"></div>
                        <div class="bar-office" style="width:${otPct / 2}%;"></div>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // 詳細テーブル（事務残業）
    const detailsSection = document.getElementById('detailsSection');
    const detailsTbody = document.querySelector('#detailsTable tbody');

    if (filteredDetails && filteredDetails.length > 0) {
        detailsSection.style.display = 'block';

        // 日付でソート（降順）
        filteredDetails.sort((a, b) => b.date.localeCompare(a.date));

        detailsTbody.innerHTML = filteredDetails.map(d => `
    < tr >
                <td>${d.date}</td>
                <td><strong>${d.name}</strong></td>
                <td>${d.project}</td>
                <td>${d.task}</td>
                <td class="numeric">${d.hours.toFixed(1)}</td>
            </tr >
    `).join('');
    } else {
        detailsSection.style.display = 'none';
    }
}
