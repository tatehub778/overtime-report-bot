// ドラッグ&ドロップの初期化
function initDragAndDrop() {
    const cards = document.querySelectorAll('.employee-card');
    let draggedElement = null;

    cards.forEach(card => {
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-id', card.querySelector('.employee-name')?.textContent || '');

        card.addEventListener('dragstart', function (e) {
            draggedElement = this;
            this.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
        });

        card.addEventListener('dragend', function (e) {
            this.style.opacity = '1';
            cards.forEach(c => c.classList.remove('drag-over'));
        });

        card.addEventListener('dragover', function (e) {
            if (e.preventDefault) {
                e.preventDefault();
            }
            e.dataTransfer.dropEffect = 'move';

            // 同じコンテナ内でのみドロップ可能
            if (draggedElement && this.parentNode === draggedElement.parentNode) {
                this.classList.add('drag-over');
            }

            return false;
        });

        card.addEventListener('dragleave', function (e) {
            this.classList.remove('drag-over');
        });

        card.addEventListener('drop', async function (e) {
            if (e.stopPropagation) {
                e.stopPropagation();
            }

            // 同じコンテナ内でのみドロップを許可
            if (draggedElement && this.parentNode === draggedElement.parentNode && draggedElement !== this) {
                // 要素の順序を入れ替え
                const parent = this.parentNode;
                const allCards = Array.from(parent.querySelectorAll('.employee-card'));
                const draggedIndex = allCards.indexOf(draggedElement);
                const targetIndex = allCards.indexOf(this);

                if (draggedIndex < targetIndex) {
                    parent.insertBefore(draggedElement, this.nextSibling);
                } else {
                    parent.insertBefore(draggedElement, this);
                }

                // 順序を保存
                await saveEmployeeOrderFromContainer(parent);
            }

            this.classList.remove('drag-over');
            return false;
        });

        // ドラッグハンドルを追加
        const header = card.querySelector('.employee-header');
        if (header && !header.querySelector('.drag-handle')) {
            const handle = document.createElement('span');
            handle.className = 'drag-handle';
            handle.style.cssText = 'cursor: grab; font-size: 18px; color: #9CA3AF; margin-right: 8px;';
            handle.textContent = '☰';
            header.insertBefore(handle, header.firstChild);
        }
    });
}

// 従業員の順序を保存
async function saveEmployeeOrderFromContainer(container) {
    const cards = container.querySelectorAll('.employee-card');

    // カードからIDを抽出（employee objectから取得）
    const employeeIds = [];
    cards.forEach((card, index) => {
        // カード内のボタンからIDを抽出
        const editBtn = card.querySelector('button[onclick^="openEditModal"]');
        if (editBtn) {
            const match = editBtn.getAttribute('onclick').match(/'([^']+)'/);
            if (match) {
                employeeIds.push(match[1]);
            }
        }
    });

    if (employeeIds.length === 0) return;

    try {
        const response = await fetch('/api/employees', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'reorder',
                employeeIds
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save order');
        }

        console.log('✅ 順序を保存しました');
        // データを再読み込み（順序を反映）
        if (typeof loadEmployees === 'function') {
            await loadEmployees();
        }
    } catch (error) {
        console.error('Error saving order:', error);
        alert('❌ 順序の保存に失敗しました');
        // エラー時は元に戻す
        if (typeof loadEmployees === 'function') {
            await loadEmployees();
        }
    }
}

// renderEmployees関数の最後で呼び出す
if (typeof renderEmployees !== 'undefined') {
    const originalRenderEmployees = renderEmployees;
    renderEmployees = function () {
        originalRenderEmployees();
        setTimeout(initDragAndDrop, 100);
    };
}
