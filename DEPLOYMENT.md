# 🚀 デプロイガイド

## 前提条件

1. ✅ Vercelアカウント（無料）
2. ✅ LINE公式アカウント
3. ✅ GitHubアカウント（推奨）

---

## Step 1: LINE Bot設定

### 1.1 LINE Developers Consoleで設定

1. [LINE Developers Console](https://developers.line.biz/console/)にアクセス
2. 「新規チャネル作成」→「Messaging API」を選択
3. 必要事項を入力して作成

### 1.2 必要な情報を取得

以下の情報をメモしてください：

- **Channel Secret**: Basicタブから取得
- **Channel Access Token**: Messaging API タブで「発行」ボタンをクリック

### 1.3 Webhook設定（後で設定）

Messaging APIタブで以下を設定：
- 「Webhook URL」: 後でVercelのURLを設定
- 「Webhookの利用」: オン
- 「応答メッセージ」: オフ（重要！）
- 「あいさつメッセージ」: オフ

---

## Step 2: Vercelデプロイ

### 方法A: GitHub経由（推奨）

#### 1. GitHubリポジトリ作成

```bash
cd C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot
git init
git add .
git commit -m "Initial commit"
```

GitHubで新規リポジトリを作成後：

```bash
git remote add origin https://github.com/あなたのユーザー名/overtime-report-bot.git
git branch -M main
git push -u origin main
```

#### 2. Vercelでインポート

1. [Vercel](https://vercel.com/)にログイン
2. 「Add New...」→「Project」
3. GitHubリポジトリをインポート
4. 「Deploy」をクリック

### 方法B: Vercel CLI（簡単）

```bash
cd C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot

# Vercel CLIをインストール（初回のみ）
npm install -g vercel

# ログイン
vercel login

# デプロイ
vercel --prod
```

---

## Step 3: Vercel KVの設定

### 3.1 KVデータベース作成

1. Vercelダッシュボード→プロジェクトを選択
2. 「Storage」タブ→「Create Database」
3. 「KV」を選択
4. データベース名を入力（例: `overtime-reports-db`）
5. リージョンは「Tokyo (hnd1)」を選択
6. 「Create」

### 3.2 環境変数の自動設定

KV作成後、自動的に以下の環境変数が設定されます：
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

---

## Step 4: LINE Bot環境変数の設定

### 4.1 Vercelダッシュボードで設定

1. プロジェクト→「Settings」→「Environment Variables」
2. 以下を追加：

| Name | Value |
|------|-------|
| `LINE_CHANNEL_ACCESS_TOKEN` | （Step 1.2で取得したトークン） |
| `LINE_CHANNEL_SECRET` | （Step 1.2で取得したシークレット） |

3. 「Save」をクリック

### 4.2 再デプロイ

環境変数追加後、再デプロイが必要です：

```bash
vercel --prod
```

または、Vercelダッシュボードの「Deployments」→「Redeploy」

---

## Step 5: LINE Webhook URL設定

### 5.1 VercelのURLを確認

デプロイ完了後、以下のようなURLが発行されます：
```
https://your-project-name.vercel.app
```

### 5.2 LINE Developers Consoleで設定

1. LINE Developers Console→チャネル→「Messaging API」タブ
2. 「Webhook URL」に以下を入力：
```
https://your-project-name.vercel.app/api/webhook
```
3. 「検証」ボタンをクリックして成功を確認
4. 「Webhookの利用」をオン

---

## Step 6: LINE Botをグループに追加

1. LINE公式アカウントのQRコードをスキャン
2. 友だち追加
3. グループLINEに招待

---

## 🎉 完成！テスト

### 1. フォームテスト

ブラウザで以下にアクセス：
```
https://your-project-name.vercel.app
```

社員名、日付、種別、時間を入力して送信

### 2. LINE通知確認

グループLINEに通知が届くことを確認

### 3. 一覧コマンドテスト

グループLINEで「一覧」と入力して、月次サマリーが表示されることを確認

---

## トラブルシューティング

### LINE通知が届かない

1. 環境変数が正しく設定されているか確認
2. Vercelのログを確認：ダッシュボード→「Logs」
3. LINE Botがグループに追加されているか確認

### Webhookエラー

1. Webhook URLが正しいか確認
2. 「応答メッセージ」がオフになっているか確認
3. Channel SecretとAccess Tokenが正しいか確認

### データが保存されない

1. Vercel KVが正しく作成されているか確認
2. 環境変数（KV_*）が設定されているか確認

---

## 次のステップ（Step 2実装時）

- CSV突合機能
- 管理画面
- アラート機能

---

## サポート

問題が発生した場合は、Vercelのログとエラーメッセージを確認してください。
