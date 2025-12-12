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
        <label class="checkbox-label">
            <input type="checkbox" name="employee" value="${emp.name}">
            <span class="checkbox-text">${emp.name}</span>
        </label>
    `).join('');

    // 管理チーム
    const managementEmployees = employees.filter(e => e.department === 'management');
    const managementContainer = document.getElementById('managementEmployees');
    managementContainer.innerHTML = managementEmployees.map(emp => `
        <label class="checkbox-label">
            <input type="checkbox" name="employee" value="${emp.name}">
            <span class="checkbox-text">${emp.name}</span>
        </label>
    `).join('');
}


// フォーム送信
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // 選択された社員を取得
    const employeeCheckboxes = document.querySelectorAll('input[name="employee"]:checked');
    const employees = Array.from(employeeCheckboxes).map(cb => cb.value);

    // バリデーション
    if (employees.length === 0) {
        showError('社員を1人以上選択してください');
        return;
    }

    const date = dateInput.value;
    const category = document.getElementById('category').value;
    const hours = parseFloat(document.getElementById('hours').value);

    if (!date || !category || !hours) {
        showError('全ての項目を入力してください');
        return;
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
                employees,
                category,
                hours,
            }),
        });

        const result = await response.json();

        if (response.ok) {
            showSuccess();
            form.reset();
            dateInput.value = today; // 日付を今日にリセット
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
