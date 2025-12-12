// フォーム要素
const form = document.getElementById('overtimeForm');
const dateInput = document.getElementById('date');
const submitBtn = document.getElementById('submitBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');

// 今日の日付をセット
const today = new Date().toISOString().split('T')[0];
dateInput.value = today;

// 社員リスト読み込み
loadEmployees();

async function loadEmployees() {
    try {
        const response = await fetch('/api/employees?active=true');
        if (!response.ok) throw new Error('Failed to load employees');

        const employees = await response.json();
        renderEmployeeCheckboxes(employees);
    } catch (error) {
        console.error('Error loading employees:', error);
        // エラー時はフォームにメッセージ表示
        document.getElementById('factoryEmployees').innerHTML =
            '<p style="color: #EF4444;">社員リストの読み込みに失敗しました</p>';
        document.getElementById('managementEmployees').innerHTML =
            '<p style="color: #EF4444;">社員リストの読み込みに失敗しました</p>';
    }
}

function renderEmployeeCheckboxes(employees) {
    // 工場チーム
    const factoryEmployees = employees.filter(e => e.department === 'factory');
    const factoryContainer = document.getElementById('factoryEmployees');
    factoryContainer.innerHTML = factoryEmployees.map(emp => `
        <div class="employee-item" data-employee="${emp.name}">
            <label class="checkbox-label">
                <input type="checkbox" name="employee" value="${emp.name}" data-employee="${emp.name}">
                <span class="checkbox-text">${emp.name}</span>
            </label>
            <div class="categories-container" style="display: none;" data-employee="${emp.name}">
                <!-- カテゴリ行が動的に追加される -->
            </div>
        </div>
    `).join('');

    // 管理チーム
    const managementEmployees = employees.filter(e => e.department === 'management');
    const managementContainer = document.getElementById('managementEmployees');
    managementContainer.innerHTML = managementEmployees.map(emp => `
        <div class="employee-item" data-employee="${emp.name}">
            <label class="checkbox-label">
                <input type="checkbox" name="employee" value="${emp.name}" data-employee="${emp.name}">
                <span class="checkbox-text">${emp.name}</span>
            </label>
            <div class="categories-container" style="display: none;" data-employee="${emp.name}">
                <!-- カテゴリ行が動的に追加される -->
            </div>
        </div>
    `).join('');

    // イベントリスナーを追加
    attachCheckboxListeners();
}

function attachCheckboxListeners() {
    const checkboxes = document.querySelectorAll('input[name="employee"]');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', handleEmployeeSelection);
    });
}

function handleEmployeeSelection(e) {
    const employeeName = e.target.value;
    const employeeItem = e.target.closest('.employee-item');
    const categoriesContainer = employeeItem.querySelector('.categories-container');

    if (e.target.checked) {
        // チェックされたらカテゴリコンテナを表示
        categoriesContainer.style.display = 'block';
        // デフォルトで1行追加
        addCategoryRow(employeeName, categoriesContainer);
    } else {
        // チェック解除されたらカテゴリコンテナを非表示＆クリア
        categoriesContainer.style.display = 'none';
        categoriesContainer.innerHTML = '';
    }
}

// カテゴリ行を追加
function addCategoryRow(employeeName, container) {
    const rowId = `cat-${Date.now()}-${Math.random()}`;
    const row = document.createElement('div');
    row.className = 'category-row';
    row.setAttribute('data-row-id', rowId);

    row.innerHTML = `
        <select class="category-select" required>
            <option value="">カテゴリ選択</option>
            <option value="早出">早出</option>
            <option value="夜勤">夜勤</option>
            <option value="休日出勤">休日出勤</option>
            <option value="事務残業">事務残業</option>
            <option value="工場残業">工場残業</option>
            <option value="現場残業">現場残業</option>
        </select>
        <input type="number" class="hours-input" placeholder="時間" min="0.25" max="24" step="0.25" required>
        <span class="hours-unit">時間</span>
        <button type="button" class="remove-row-btn" title="削除">×</button>
    `;

    // 削除ボタンのイベント
    const removeBtn = row.querySelector('.remove-row-btn');
    removeBtn.addEventListener('click', () => {
        row.remove();
        // 行がゼロになったらcontainerを非表示
        if (container.querySelectorAll('.category-row').length === 0) {
            const checkbox = container.closest('.employee-item').querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = false;
                container.style.display = 'none';
            }
        }
    });

    container.appendChild(row);

    // 追加ボタンがなければ追加
    if (!container.querySelector('.add-category-btn')) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'add-category-btn';
        addBtn.textContent = '+ カテゴリを追加';
        addBtn.addEventListener('click', () => addCategoryRow(employeeName, container));
        container.appendChild(addBtn);
    }
}


// フォーム送信
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // 選択された社員を取得
    const employeeCheckboxes = document.querySelectorAll('input[name="employee"]:checked');

    // バリデーション
    if (employeeCheckboxes.length === 0) {
        showError('社員を1人以上選択してください');
        return;
    }

    const date = dateInput.value;

    if (!date) {
        showError('日付を入力してください');
        return;
    }

    // 各従業員のカテゴリと時間を収集
    const reports = [];
    for (const checkbox of employeeCheckboxes) {
        const employeeName = checkbox.value;
        const employeeItem = checkbox.closest('.employee-item');
        const categoryRows = employeeItem.querySelectorAll('.category-row');

        if (categoryRows.length === 0) {
            showError(`${employeeName}のカテゴリと時間を入力してください`);
            return;
        }

        const categories = [];
        for (const row of categoryRows) {
            const category = row.querySelector('.category-select').value;
            const hours = parseFloat(row.querySelector('.hours-input').value);

            if (!category) {
                showError(`${employeeName}のカテゴリを選択してください`);
                return;
            }

            if (!hours || hours <= 0) {
                showError(`${employeeName}の${category}の時間を入力してください`);
                return;
            }

            categories.push({ category, hours });
        }

        reports.push({
            employee: employeeName,
            categories: categories
        });
    }

    // ローディング状態
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    hideMessages();

    // データ送信
    try {
        const response = await fetch('/api/submit-report', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                date,
                reports,
            }),
        });

        const result = await response.json();

        if (response.ok) {
            showSuccess();
            form.reset();
            dateInput.value = today; // 日付を今日にリセット

            // カテゴリコンテナを非表示
            document.querySelectorAll('.categories-container').forEach(container => {
                container.style.display = 'none';
                container.innerHTML = '';
            });
        } else {
            showError(result.error || '送信に失敗しました');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('ネットワークエラーが発生しました');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});

// 成功メッセージ表示
function showSuccess() {
    hideMessages();
    successMessage.style.display = 'flex';

    // 3秒後に非表示
    setTimeout(() => {
        successMessage.style.display = 'none';
    }, 5000);
}

// エラーメッセージ表示
function showError(message) {
    hideMessages();
    errorText.textContent = message;
    errorMessage.style.display = 'flex';

    // 5秒後に非表示
    setTimeout(() => {
        errorMessage.style.display = 'none';
    }, 5000);
}

// メッセージ非表示
function hideMessages() {
    successMessage.style.display = 'none';
    errorMessage.style.display = 'none';
}

// Service Worker登録（PWA）
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('ServiceWorker registered:', registration);
            })
            .catch(error => {
                console.log('ServiceWorker registration failed:', error);
            });
    });
}
