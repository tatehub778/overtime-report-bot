# 🚀 デプロイ手順（Gitなしバージョン）

## 状況

Gitがインストールされていないため、**Vercelの直接アップロード**を使用します。

---

## 📦 方法1: Vercel Web UIで直接デプロイ（最も簡単）

### ステップ1: プロジェクトをZIP圧縮

1. エクスプローラーで以下のフォルダを開く：
   ```
   C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot
   ```

2. **node_modules フォルダを削除**（重要！）
   - `node_modules` フォルダを右クリック→削除

3. フォルダ全体を選択して右クリック→「送る」→「圧縮 (zip形式) フォルダー」
   - ファイル名: `overtime-report-bot.zip`

### ステップ2: Vercelにアップロード

1. [Vercel](https://vercel.com)にアクセス
2. サインイン/サインアップ（GitHubアカウントまたはメールアドレス）
3. ダッシュボードで「Add New...」→「Project」
4. 「Import Third-Party Git Repository」の下の「**Deploy from ZIP**」をクリック
5. `overtime-report-bot.zip` をドラッグ&ドロップまたは選択
6. 「Deploy」をクリック

→ デプロイが開始されます！

---

## 📦 方法2: Vercel CLIでデプロイ

Vercel CLIをインストールしてデプロイする方法です。

### ステップ1: Vercel CLIをインストール

PowerShellで実行：
```powershell
npm install -g vercel
```

### ステップ2: ログイン

```powershell
vercel login
```

ブラウザが開いてログイン画面が表示されます。

### ステップ3: デプロイ

```powershell
cd C:\Users\kishi\.gemini\antigravity\scratch\overtime-report-bot
vercel --prod
```

質問に答えていくとデプロイが完了します：
- **Set up and deploy?** → `Y`
- **Which scope?** → 自分のアカウントを選択
- **Link to existing project?** → `N`
- **What's your project's name?** → `overtime-report-bot` (Enter)
- **In which directory is your code located?** → `./` (Enter)

→ デプロイ完了！URLが表示されます

---

## ⚙️ デプロイ後の必須設定

どちらの方法でも、デプロイ後に以下の設定が必要です：

### 1. Vercel KVデータベース作成

1. Vercelダッシュボード→プロジェクト選択
2. 「**Storage**」タブ
3. 「**Create Database**」
4. 「**KV**」を選択
5. データベース名: `overtime-reports-db`
6. リージョン: **Tokyo (hnd1)**
7. 「**Create**」

→ 環境変数（KV_*）が自動で設定されます

### 2. LINE Bot環境変数を追加

1. プロジェクト→「**Settings**」→「**Environment Variables**」
2. 以下を追加：

**LINE_CHANNEL_ACCESS_TOKEN**
```
（LINE Developers Consoleから取得したトークン）
```

**LINE_CHANNEL_SECRET**
```
（LINE Developers Consoleから取得したシークレット）
```

3. 「**Save**」をクリック

### 3. 再デプロイ

環境変数を追加したら、再デプロイが必要：

1. 「**Deployments**」タブ
2. 最新のデプロイメントの「**...**」→「**Redeploy**」

### 4. LINE Webhook URL設定

1. [LINE Developers Console](https://developers.line.biz/console/)
2. チャネル→「**Messaging API**」タブ
3. **Webhook URL**: `https://あなたのプロジェクト.vercel.app/api/webhook`
4. 「**検証**」ボタンをクリック→成功を確認
5. 「**Webhookの利用**」を**オン**
6. 「**応答メッセージ**」を**オフ**（重要！）

### 5. LINE Botをグループに追加

1. LINE公式アカウントのQRコードをスキャン
2. 友だち追加
3. グループLINEに招待

---

## 🎉 完成！

### テスト

1. **フォームアクセス**: `https://あなたのプロジェクト.vercel.app`
2. **報告送信**: 社員選択→日付→種別→時間→送信
3. **LINE通知確認**: グループに通知が届く
4. **一覧コマンド**: LINEで「一覧」と入力→月次サマリー表示

---

## 💡 次回以降の更新方法

### コードを変更したら：

1. プロジェクトをZIP圧縮（node_modules除く）
2. Vercelダッシュボード→プロジェクト
3. 「Deployments」→「Deploy」→ZIPアップロード

または、**Git をインストール**すると自動デプロイが使えます：
- [Git for Windows](https://git-scm.com/download/win)

---

## 📝 おすすめ

時間があれば **Git for Windows** をインストールすることをおすすめします。
今後のコード管理が格段に楽になります！

**どの方法で進めますか？**
