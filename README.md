# 📱 LINE Bot秘書 & CBO監査システム

残業報告をLINEで管理し、CBOとの突合を自動化するシステムです。

## 🚀 機能

### Step 1（完了）
- ✅ Webフォームで残業報告（複数人同時報告可能）
- ✅ LINEグループへの自動通知
- ✅ 「一覧」コマンドで月次サマリー表示

### Step 2（完了）
- ✅ CSVアップロード機能
- ✅ CBO打刻との突合
- ✅ 未報告・ずれの自動検出
- ✅ 見やすい差異レポート表示
- ✅ CSV出力機能

## 🛠️ 技術スタック

- **フロントエンド**: HTML/CSS/JavaScript (PWA)
- **バックエンド**: Vercel Serverless Functions
- **データベース**: Vercel KV (Redis)
- **LINE連携**: LINE Messaging API

## 📦 セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example`を`.env`にコピーして、以下を設定：

```bash
# LINE Bot設定（LINE Developers Consoleから取得）
LINE_CHANNEL_ACCESS_TOKEN=your_token_here
LINE_CHANNEL_SECRET=your_secret_here

# Vercel KV設定（Vercelダッシュボードから取得）
KV_REST_API_URL=your_url_here
KV_REST_API_TOKEN=your_token_here
```

### 3. ローカル開発

```bash
npm run dev
```

`http://localhost:3000`でアクセス可能

### 4. Vercelへデプロイ

```bash
npm run deploy
```

または、GitHubと連携して自動デプロイ

## 🎯 使い方

### 残業報告

1. フォームURLを開く
2. 社員名を選択（複数選択可）
3. 日付を選択
4. 残業種別を選択
5. 時間を入力
6. 送信

→ LINEグループに通知が届きます

### 一覧表示

LINEグループで「一覧」と入力すると、今月の残業状況が表示されます。

## 🔧 LINE Bot設定

### Webhook URL

Vercelデプロイ後、以下のURLをLINE Developers ConsoleのWebhook URLに設定：

```
https://your-app.vercel.app/api/webhook
```

### グループへの追加

LINE Botをグループに招待してください。

## 📝 データ構造

### overtime_reports

```json
{
  "id": "uuid",
  "date": "2025-11-04",
  "employees": ["田中 祐太", "山本 太郎"],
  "category": "現場残業",
  "hours": 2.5,
  "created_at": "2025-11-04T18:30:00Z",
  "updated_at": "2025-11-04T18:30:00Z"
}
```

## 📄 ライセンス

MIT
