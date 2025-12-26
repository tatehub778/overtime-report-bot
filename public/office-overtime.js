/**
 * Office Overtime Analysis Logic
 * Handles CSV parsing, data aggregation, and rendering.
 */

document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const dashboardContent = document.getElementById('dashboardContent');
    const monthFilter = document.getElementById('monthFilter');
    const resetBtn = document.getElementById('resetBtn');

    let rawData = [];
    let uniqueTaskTypes = new Set();

    // Event Listeners
    uploadArea.addEventListener('click', () => fileInput.click());

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.csv')) {
            processFile(file);
        } else {
            alert('CSVファイルを選択してください。');
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    });

    monthFilter.addEventListener('change', renderDashboard);

    resetBtn.addEventListener('click', () => {
        dashboardContent.style.display = 'none';
        uploadArea.style.display = 'block';
        fileInput.value = '';
        rawData = [];
        uniqueTaskTypes.clear();
    });

    function processFile(file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            const text = e.target.result;
            try {
                // Parse CSV using robust parser
                const rows = parseCSVText(text);

                // Analyze headers to detect indices
                if (rows.length < 2) throw new Error('データが空です');

                const headers = rows[0];

                // Based on User Spec + Standard Header:
                // Col A(0): 日付 (作業日)
                // Col B(1): 名前 (報告者)
                // Col C(2): 案件名 (Project)
                // Col F(5): 事務残業時間 (Overtime)
                // Col G(6): 内容 (Content)

                const idx = {
                    date: headers.indexOf('作業日'),
                    name: headers.indexOf('報告者'),
                    project: headers.indexOf('案件名'),
                    overtime: headers.indexOf('残業時間'), // Col F
                    content: headers.indexOf('作業内容')   // Col G
                };

                // Fallback fixed indices if headers don't match for some reason (User said A,B,C,F,G)
                if (idx.date === -1) idx.date = 0;
                if (idx.name === -1) idx.name = 1;
                if (idx.project === -1) idx.project = 2;
                if (idx.overtime === -1) idx.overtime = 5;
                if (idx.content === -1) idx.content = 6;

                rawData = [];
                uniqueTaskTypes = new Set();

                // Start from line 1
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.length < 5) continue; // Skip empty/malformed rows

                    const rawName = row[idx.name] || '';
                    if (!rawName) continue;

                    const cleanName = cleanEmployeeName(rawName);
                    const dateStr = row[idx.date] || '';
                    const content = row[idx.content] || 'その他';
                    const project = row[idx.project] || '-';

                    // Parse Time "HH:MM" -> hours (float)
                    const timeStr = row[idx.overtime];
                    const hours = parseTime(timeStr);

                    // User feedback implies we only care about rows in this file.
                    // If filtering by "0 hours" is needed, we can add it, 
                    // but sometimes 0h records show "Work done" even if no overtime charged.
                    // However, for "Overtime Analysis", 0h might be noise. 
                    // Let's keep them for now in Detail View, but they won't affect sums.

                    rawData.push({
                        date: dateStr,
                        rawDate: parseDate(dateStr),
                        name: cleanName,
                        project: project,
                        hours: hours,
                        content: content
                    });

                    uniqueTaskTypes.add(content);
                }

                // Switch view
                uploadArea.style.display = 'none';
                dashboardContent.style.display = 'block';

                // Initial render
                initializeFilters();
                renderDashboard();

            } catch (err) {
                console.error(err);
                alert('CSVの読み込みに失敗しました。詳細: ' + err.message);
            }
        };
        reader.readAsText(file);
    }

    /**
     * Robust CSV Parser that handles newlines inside quotes
     */
    function parseCSVText(text) {
        const rows = [];
        let currentRow = [];
        let currentCell = '';
        let insideQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (char === '"') {
                if (insideQuotes && nextChar === '"') {
                    // Escaped quote
                    currentCell += '"';
                    i++; // Skip next quote
                } else {
                    // Toggle quote state
                    insideQuotes = !insideQuotes;
                }
            } else if (char === ',' && !insideQuotes) {
                // End of cell
                currentRow.push(currentCell);
                currentCell = '';
            } else if ((char === '\r' || char === '\n') && !insideQuotes) {
                // End of row
                // Handle CRLF (skip \n if previous was \r)
                if (char === '\r' && nextChar === '\n') {
                    i++;
                }

                currentRow.push(currentCell);
                rows.push(currentRow);
                currentRow = [];
                currentCell = '';
            } else {
                currentCell += char;
            }
        }

        // Push last row if exists
        if (currentRow.length > 0 || currentCell.length > 0) {
            currentRow.push(currentCell);
            rows.push(currentRow);
        }

        return rows;
    }

    function cleanEmployeeName(name) {
        // Remove numbers at end "田中 祐太 023" -> "田中 祐太"
        return name.replace(/\s*\d+$/, '').trim();
    }

    function parseTime(timeStr) {
        if (!timeStr) return 0;
        // Check for decimal format first (e.g. "1.5")
        if (timeStr.includes('.') && !timeStr.includes(':')) {
            return parseFloat(timeStr);
        }

        // Standard "HH:MM" format
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            return h + (m / 60);
        }
        return 0;
    }

    function parseDate(dateStr) {
        if (!dateStr) return new Date(0);
        // "2025年12月25日" -> Date Object
        const match = dateStr.match(/(\d+)年(\d+)月(\d+)日/);
        if (match) {
            return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        }
        // Fallback for "YYYY/MM/DD" or "YYYY-MM-DD"
        return new Date(dateStr);
    }

    function initializeFilters() {
        // Extract unique months
        const months = new Set();
        rawData.forEach(d => {
            if (d.rawDate.getTime() === 0) return;
            const k = `${d.rawDate.getFullYear()}年${d.rawDate.getMonth() + 1}月`;
            months.add(k);
        });

        // clear options except "all"
        monthFilter.innerHTML = '<option value="all">全期間</option>';

        // Sort months desc
        const sortedMonths = Array.from(months).sort((a, b) => {
            const [y1, m1] = a.match(/(\d+)/g).map(Number);
            const [y2, m2] = b.match(/(\d+)/g).map(Number);
            return (y2 * 100 + m2) - (y1 * 100 + m1);
        });

        sortedMonths.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            monthFilter.appendChild(opt);
        });
    }

    function renderDashboard() {
        const selectedMonth = monthFilter.value;

        // Filter Data
        const filteredData = rawData.filter(d => {
            if (selectedMonth === 'all') return true;
            const m = `${d.rawDate.getFullYear()}年${d.rawDate.getMonth() + 1}月`;
            return m === selectedMonth;
        });

        // Set unique tasks array for consistent column ordering
        const taskTypesArray = Array.from(uniqueTaskTypes).sort();

        // Aggregation: Map<Name, { total: number, breakdown: { [task]: number } }>
        const agg = new Map();
        let grandTotal = 0;

        filteredData.forEach(d => {
            if (!agg.has(d.name)) {
                agg.set(d.name, { total: 0, breakdown: {} });
                taskTypesArray.forEach(t => agg.get(d.name).breakdown[t] = 0);
            }
            const entry = agg.get(d.name);
            entry.total += d.hours;

            const taskKey = d.content;
            if (entry.breakdown[taskKey] !== undefined) {
                entry.breakdown[taskKey] += d.hours;
            } else {
                entry.breakdown[taskKey] = d.hours;
            }

            grandTotal += d.hours;
        });

        // Calculate Summary
        document.getElementById('totalEmployees').textContent = `${agg.size}名`;
        document.getElementById('grandTotalHours').textContent = `${grandTotal.toFixed(1)}h`;

        const typeTotals = {};
        filteredData.forEach(d => {
            const t = d.content;
            typeTotals[t] = (typeTotals[t] || 0) + d.hours;
        });
        const topTask = Object.entries(typeTotals).sort((a, b) => b[1] - a[1])[0];
        document.getElementById('topTaskType').textContent = topTask ? `${topTask[0]} (${topTask[1].toFixed(1)}h)` : '-';


        // --- Render Summary Table ---
        const thead = document.querySelector('#analysisTable thead');
        const tbody = document.querySelector('#analysisTable tbody');

        thead.innerHTML = '';
        tbody.innerHTML = '';

        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th>氏名</th>
            <th class="numeric total-col">合計時間</th>
            ${taskTypesArray.map(t => `<th class="numeric">${t}</th>`).join('')}
        `;
        thead.appendChild(headerRow);

        const sortedEmployees = Array.from(agg.entries()).sort((a, b) => b[1].total - a[1].total);

        sortedEmployees.forEach(([name, data]) => {
            const tr = document.createElement('tr');
            let cells = `
                <td>${name}</td>
                <td class="numeric total-col">${data.total.toFixed(1)}</td>
            `;

            taskTypesArray.forEach(t => {
                const val = data.breakdown[t] || 0;
                const cellClass = val > 0 ? "numeric" : "numeric text-muted";
                const display = val > 0 ? val.toFixed(1) : '-';
                cells += `<td class="${cellClass}">${display}</td>`;
            });

            tr.innerHTML = cells;
            tbody.appendChild(tr);
        });

        if (sortedEmployees.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${2 + taskTypesArray.length}" style="text-align:center; padding: 20px;">データがありません</td></tr>`;
        }


        // --- Render Details Table ---
        const detailsBody = document.querySelector('#detailsTable tbody');
        detailsBody.innerHTML = '';

        // Sort filtered data by date desc, then name
        filteredData.sort((a, b) => b.rawDate - a.rawDate || a.name.localeCompare(b.name));

        filteredData.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${d.date}</td>
                <td>${d.name}</td>
                <td class="text-wrap">${d.project}</td>
                <td>${d.content}</td>
                <td class="numeric">${d.hours > 0 ? d.hours.toFixed(1) : '0'}</td>
            `;
            detailsBody.appendChild(tr);
        });

        if (filteredData.length === 0) {
            detailsBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px;">データがありません</td></tr>`;
        }
    }
});
