# 🚀 GitHub経由でデプロイする手順

## ⚠️ 重要：PowerShellを再起動してください

Git for Windowsをインストールしたばかりなので、PowerShellを再起動する必要があります。

### PowerShellの再起動方法

1. 現在開いているPowerShellウィンドウを**閉じる**
2. 新しくPowerShellを開く
3. 以下のコマンドで確認：
   ```powershell
   git --version
   ```
   → バージョンが表示されればOK！

---

## 📝 再起動後の手順

### ステップ1: Gitの初期設定

PowerShellで以下を実行：

```powershell
# あなたの名前を設定（例: Taro Yamada）
git config --global user.name "あなたの名前"

# あなたのメールアドレスを設定（GitHubで使うメール）
git config --global user.email "your.email@example.com"
```

### ステップ2: Gitリポジトリを初期化

```powershell
cd C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot

git init
git add .
git commit -m "Initial commit: Step 1 implementation"
```

### ステップ3: GitHubリポジトリを作成

1. [GitHub](https://github.com)にアクセスしてログイン
2. 右上の「**+**」→「**New repository**」
3. 以下を入力：
   - **Repository name**: `overtime-report-bot`
   - **Public** を選択
   - **Add a README file**: チェック**しない**
   - **Add .gitignore**: None
   - **Choose a license**: None
4. 「**Create repository**」をクリック

### ステップ4: GitHubにプッシュ

GitHubで表示された画面の「**...or push an existing repository from the command line**」にあるコマンドをコピーして実行：

```powershell
git remote add origin https://github.com/あなたのユーザー名/overtime-report-bot.git
git branch -M main
git push -u origin main
```

**注意**: 初回プッシュ時、GitHubのログインを求められる場合があります。

### ステップ5: Vercelでインポート

1. [Vercel](https://vercel.com)にアクセス
2. GitHubアカウントでサインイン/ログイン
3. 「**Add New...**」→「**Project**」
4. GitHubリポジトリ「**overtime-report-bot**」を見つける
5. 「**Import**」をクリック
6. そのまま「**Deploy**」をクリック

→ デプロイが開始されます！

### ステップ6: Vercel KVデータベース作成

1. Vercelダッシュボード→プロジェクトを選択
2. 「**Storage**」タブ
3. 「**Create Database**」
4. 「**KV**」を選択
5. データベース名: `overtime-reports-db`
6. リージョン: **Tokyo (hnd1)**
7. 「**Create**」

### ステップ7: LINE Bot環境変数を設定

1. プロジェクト→「**Settings**」→「**Environment Variables**」
2. 以下を追加：

| Name | Value |
|------|-------|
| `LINE_CHANNEL_ACCESS_TOKEN` | （LINE Developers Consoleから取得） |
| `LINE_CHANNEL_SECRET` | （LINE Developers Consoleから取得） |

3. 「**Save**」

### ステップ8: 再デプロイ

1. 「**Deployments**」タブ
2. 最新のデプロイメントの「**...**」→「**Redeploy**」

### ステップ9: LINE Webhook URL設定

1. [LINE Developers Console](https://developers.line.biz/console/)
2. チャネル→「**Messaging API**」タブ
3. **Webhook URL**: `https://あなたのプロジェクト.vercel.app/api/webhook`
4. 「**検証**」→成功を確認
5. 「**Webhookの利用**」を**オン**
6. 「**応答メッセージ**」を**オフ**

### ステップ10: LINE Botをグループに追加

1. LINE公式アカウントのQRコードをスキャン
2. 友だち追加
3. グループLINEに招待

---

## 🎉 完成！

### テスト

1. **フォーム**: `https://あなたのプロジェクト.vercel.app`
2. **報告送信**: 社員選択→送信
3. **LINE通知確認**
4. **一覧コマンド**: LINEで「一覧」

---

## 💡 今後の更新方法

コードを変更したら：

```powershell
cd C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot

git add .
git commit -m "変更内容の説明"
git push
```

→ 自動的にVercelに再デプロイされます！

---

## 📝 次にやること

1. **PowerShellを再起動**
2. `git --version` で確認
3. 上記の手順を実行

質問があればいつでも聞いてください！
