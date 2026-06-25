# プログラミング体験ゲーム

Telloドローンを直感的でポップなブロックプログラミング（Google Blockly）を使って動かすことができる、オープンキャンパス用プログラミング体験アプリ。

---

## 📥 導入方法

### 1. リポジトリをクローン
```bash
git clone "https://github.com/natsuneco/tello-programming-hands-on"
cd tello-programming-hands-on
```

### 2. 仮想環境の作成
Python 3.10 ~ 3.12がインストールされていることを確認し、プロジェクトルートで以下を実行します。
```bash
python -m venv venv
```

### 3. 仮想環境の有効化
OS/シェルに合わせて実行してください。

* **Windows (PowerShell)**:
  ```powershell
  # 実行ポリシーのエラーが出る場合は先に以下を実行してください
  # Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
  .\venv\Scripts\Activate.ps1
  ```
* **Windows (コマンドプロンプト)**:
  ```cmd
  .\venv\Scripts\activate.bat
  ```
* **macOS / Linux**:
  ```bash
  source venv/bin/activate
  ```

### 4. パッケージのインストール
```bash
pip install -r requirements.txt
```

### 5. サーバーの起動
```bash
python app.py
```
起動に成功すると、ローカルサーバーが立ち上がります。ブラウザで以下のURLを開いてください。

[http://localhost:5000](http://localhost:5000)

---

## 🎮 使い方

1. Telloドローンの電源を入れます。
2. PCのWi-Fi接続設定を開き、ドローンが発信しているネットワーク（例: `TELLO-XXXXXX`）に直接接続します。
3. アプリ画面右上にある **「再接続」** ボタンをクリックします。
4. 接続に成功すると、左上のカメラフィードがドローンのリアルタイム映像に切り替わります。

---

## ⚙️ ゲームの設定とターゲットの印刷

### マーカーの配点設定 ＆ 印刷
ブラウザで以下のURLに直接アクセスするか、エディタ画面の右上「設定」→「配点設定・印刷ページを開く」をクリックします。

[http://localhost:5000/settings](http://localhost:5000/settings)

* **配点設定**: 各ターゲットマーカー（ID 0 〜 4）ごとに獲得できる得点比率をカスタマイズして保存できます。
* **印刷**: 各マーカー画像をクリックすると、A4用紙に大きくフィットした状態でマーカー・ID・配点数がレイアウトされ、印刷ダイアログが開きます。

