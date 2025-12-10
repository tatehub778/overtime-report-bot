# 🚀 デプロイ手順（簡易版）

## 現在の状況

✅ npm依存関係のインストール完了（277パッケージ）

---

## 次のステップ

### オプション1: GitHub経由でデプロイ（推奨・簡単）

これが一番簡単で、自動デプロイも設定できます。

#### 1. GitHubリポジトリを作成

1. [GitHub](https://github.com)にアクセスしてログイン
2. 右上の「+」→「New repository」
3. リポジトリ名: `overtime-report-bot`
4. Publicを選択
5. 「Create repository」をクリック

#### 2. コードをプッシュ

以下のコマンドを実行：

```powershell
cd C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot

# Gitの初期化
git init

# 全ファイルをステージング
git add .

# コミット
git commit -m "Initial commit: Step 1 implementation"

# GitHubリポジトリをリモートに追加（URLは自分のリポジトリに置き換え）
git remote add origin https://github.com/あなたのユーザー名/overtime-report-bot.git

# プッシュ
git branch -M main
git push -u origin main
```

#### 3. Vercelでインポート

1. [Vercel](https://vercel.com)にアクセス
2. GitHubアカウントでサインイン/ログイン
3. 「Add New...」→「Project」
4. GitHubリポジトリ「overtime-report-bot」を選択
5. 「Import」をクリック
6. **そのまま「Deploy」をクリック**（設定不要）

デプロイが完了すると、URLが発行されます（例: `https://overtime-report-bot-xxx.vercel.app`）

---

### オプション2: Vercel CLIでデプロイ

#### 1. Vercel CLIをインストール

```powershell
npm install -g vercel
```

#### 2. ログイン

```powershell
vercel login
```

ブラウザが開いたらログイン

#### 3. デプロイ

```powershell
cd C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot
vercel --prod
```

質問に答えていくとデプロイが完了します

---

## デプロイ後の設定（必須）

どちらの方法でデプロイしても、以下の設定が必要です：

### 1. Vercel KVデータベース作成

1. Vercelダッシュボード→プロジェクトを選択
2. 「Storage」タブ
3. 「Create Database」
4. 「KV」を選択
5. データベース名: `overtime-reports-db`
6. リージョン: `Tokyo (hnd1)`
7. 「Create」

→ 環境変数が自動で設定されます

### 2. LINE Bot環境変数を追加

1. プロジェクト→「Settings」→「Environment Variables」
2. 以下を追加：

| Name | Value |
|------|-------|
| `LINE_CHANNEL_ACCESS_TOKEN` | （LINE Developers Consoleから取得） |
| `LINE_CHANNEL_SECRET` | （LINE Developers Consoleから取得） |

3. 「Save」

### 3. 再デプロイ

環境変数追加後、再デプロイが必要：

- GitHub経由の場合: 「Deployments」→「Redeploy」
- CLI の場合: `vercel --prod` を再実行

### 4. LINE Webhook URL設定

1. LINE Developers Console
2. Messaging API タブ
3. Webhook URL: `https://あなたのアプリ.vercel.app/api/webhook`
4. 「検証」→「Webhookの利用」をオン

### 5. LINE Botをグループに追加

QRコードから友だち追加→グループに招待

---

## 完成！

これで使えるようになります：

1. **フォーム**: `https://あなたのアプリ.vercel.app`
2. **LINE通知**: フォーム送信後に自動通知
3. **一覧**: LINEで「一覧」と入力

---

## 📝 メモ

- GitHub経由の方が管理しやすいです
- 今後のコード変更も `git push` で自動デプロイされます
- Vercel CLIは手軽ですが、継続的な管理が少し面倒です

**どちらの方法で進めますか？**
