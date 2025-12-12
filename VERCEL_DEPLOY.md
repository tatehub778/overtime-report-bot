# 🚀 Vercelデプロイ手順

## 方法1: GitHub連携（推奨）

最も簡単でおすすめの方法です。

### ステップ1: 変更をGitHubにプッシュ

```bash
# すべての変更をステージング
git add .

# コミット
git commit -m "feat: CBO CSV検証機能を追加"

# GitHubにプッシュ
git push origin main
```

### ステップ2: Vercelでプロジェクトをインポート

1. **Vercelにアクセス**: https://vercel.com
2. **GitHubでログイン**: すでにログイン済みとのことなので、そのまま進む
3. **「Add New」→「Project」をクリック**
4. **GitHubリポジトリを選択**:
   - `overtime-report-bot` を見つけてクリック
5. **「Import」をクリック**
6. **プロジェクト設定**:
   - Framework Preset: `Other`
   - Root Directory: `./` （デフォルトのまま）
   - Build Command: 空欄でOK
   - Output Directory: `public`
   - Install Command: `npm install`

### ステップ3: 環境変数を設定

「Environment Variables」セクションで以下を設定:

| Name | Value |
|------|-------|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINEのチャネルアクセストークン |
| `LINE_CHANNEL_SECRET` | LINEのチャネルシークレット |
| `KV_REST_API_URL` | Vercel KVのREST API URL |
| `KV_REST_API_TOKEN` | Vercel KVのREST APIトークン |

### ステップ4: デプロイ

1. **「Deploy」ボタンをクリック**
2. 数分待つとデプロイ完了！
3. デプロイされたURLが表示されます（例: `https://overtime-report-bot.vercel.app`）

---

## 方法2: Vercel CLI（コマンドライン）

コマンドラインで直接デプロイする方法です。

### ステップ1: Vercel CLIにログイン

```bash
# GitHubでログイン
vercel login --github
```

ブラウザが開くので、GitHubで認証してください。

### ステップ2: プロジェクトをリンク

```bash
# プロジェクトディレクトリで実行
vercel link
```

質問に答えていきます:
- `Set up and deploy "~/overtime-report-bot"?` → `Y`
- `Which scope do you want to deploy to?` → あなたのアカウント名を選択
- `Link to existing project?` → `N` （初回の場合）
- `What's your project's name?` → `overtime-report-bot`（デフォルトでOK）
- `In which directory is your code located?` → `./`（デフォルトでOK）

### ステップ3: 環境変数を設定

```bash
# LINEトークン
vercel env add LINE_CHANNEL_ACCESS_TOKEN

# LINEシークレット
vercel env add LINE_CHANNEL_SECRET

# Vercel KV URL
vercel env add KV_REST_API_URL

# Vercel KV トークン
vercel env add KV_REST_API_TOKEN
```

各コマンド実行後、値を入力してください。

### ステップ4: デプロイ

```bash
# 本番環境にデプロイ
vercel --prod
```

完了すると、デプロイURLが表示されます！

---

## Vercel KVの設定

Vercel KVを使用するには、Vercelダッシュボードで設定が必要です。

### 手順:

1. **Vercelダッシュボード**にアクセス: https://vercel.com/dashboard
2. **プロジェクトを選択**
3. **「Storage」タブをクリック**
4. **「Create Database」をクリック**
5. **「KV」を選択**
6. **データベース名を入力**（例: `overtime-reports-kv`）
7. **「Create」をクリック**
8. **「Connect to Project」で現在のプロジェクトを選択**
9. 環境変数が自動的に設定されます！

---

## デプロイ後の確認

### 1. アプリにアクセス

デプロイURLにアクセスして、正常に動作するか確認:
- トップページ: `https://your-app.vercel.app/`
- 管理画面: `https://your-app.vercel.app/admin.html`
- CBO検証: `https://your-app.vercel.app/cbo-verify.html`

### 2. LINE Webhook URLを更新

LINE Developers Consoleで、Webhook URLを更新:

```
https://your-app.vercel.app/api/webhook
```

### 3. テスト

1. 残業報告を送信
2. LINEに通知が届くか確認
3. CBO CSVをアップロードして検証

---

## トラブルシューティング

### エラー: `No existing credentials found`

```bash
# GitHubで再ログイン
vercel login --github
```

### エラー: `Missing environment variables`

Vercelダッシュボードで環境変数を確認:
1. プロジェクトを開く
2. 「Settings」→「Environment Variables」
3. 必要な変数がすべて設定されているか確認

### ビルドエラー

`vercel.json` の設定を確認:
```json
{
  "buildCommand": "",
  "outputDirectory": "public"
}
```

---

## 推奨: 自動デプロイ設定

GitHub連携を使用すると、`main` ブランチにプッシュするたびに自動的にデプロイされます！

これで開発がさらに効率的になります 🚀
