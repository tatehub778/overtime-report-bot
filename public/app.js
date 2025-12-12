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
            <div class="hours-input-wrapper" style="display: none;">
                <input type="number" 
                       class="hours-input" 
                       id="hours-${emp.name.replace(/\s/g, '_')}" 
                       placeholder="時間" 
                       min="0.5" 
                       max="24" 
                       step="0.5">
                <span class="hours-unit">時間</span>
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
            <div class="hours-input-wrapper" style="display: none;">
                <input type="number" 
                       class="hours-input" 
                       id="hours-${emp.name.replace(/\s/g, '_')}" 
                       placeholder="時間" 
                       min="0.5" 
                       max="24" 
                       step="0.5">
                <span class="hours-unit">時間</span>
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
    const hoursWrapper = employeeItem.querySelector('.hours-input-wrapper');
    const hoursInput = employeeItem.querySelector('.hours-input');

    if (e.target.checked) {
        // チェックされたら時間入力を表示
        hoursWrapper.style.display = 'flex';
        hoursInput.focus();
    } else {
        // チェック解除されたら時間入力を非表示＆クリア
        hoursWrapper.style.display = 'none';
        hoursInput.value = '';
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
    const category = document.getElementById('category').value;

    if (!date || !category) {
        showError('日付とカテゴリーを入力してください');
        return;
    }

    // 各従業員の時間を収集
    const reports = [];
    for (const checkbox of employeeCheckboxes) {
        const employeeName = checkbox.value;
        const hoursInputId = `hours-${employeeName.replace(/\s/g, '_')}`;
        const hoursInput = document.getElementById(hoursInputId);
        const hours = parseFloat(hoursInput.value);

        if (!hours || hours <= 0) {
            showError(`${employeeName}の時間を入力してください`);
            return;
        }

        reports.push({
            employee: employeeName,
            hours: hours
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
                category,
                reports,
            }),
        });

        const result = await response.json();

        if (response.ok) {
            showSuccess();
            form.reset();
            dateInput.value = today; // 日付を今日にリセット

            // 時間入力フィールドを非表示
            document.querySelectorAll('.hours-input-wrapper').forEach(wrapper => {
                wrapper.style.display = 'none';
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
