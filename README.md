# 寶貝斷層 260313 切片網頁

這個資料夾已經整理成可發佈到 GitHub Pages 的靜態站。

## 結構

- `index.html`, `app.js`, `styles.css` 是前端 viewer
- `data/` 放切片 PNG 和 `manifest.js`
- `build_viewer.py` 只在本機用來從 ISO 重新產生切片
- `.github/workflows/pages.yml` 會把可發佈檔案丟到 GitHub Pages
- `push_to_github.ps1` 可以把整個資料夾批次推上 GitHub

## 批量上傳

不要用 GitHub 網頁一個個上傳。這個資料夾有很多檔案，直接用 PowerShell 批次推送比較穩。

```powershell
.\push_to_github.ps1 -RemoteUrl https://github.com/<user>/<repo>.git
```

如果你想改提交訊息：

```powershell
.\push_to_github.ps1 -RemoteUrl https://github.com/<user>/<repo>.git -CommitMessage "Add DICOM slice viewer"
```

第一次使用前，如果還沒設定 git 身分，先跑一次：

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## GitHub Desktop

如果你已經裝好並登入 GitHub Desktop，這是最簡單的做法：

1. 在 GitHub Desktop 選 `File -> Add local repository`
2. 選這個資料夾 `M:\CODEX\寶貝斷層260313_切片網頁`
3. 如果它還不是 repo，先按 `Create a repository`，名稱可以用 `CT`
4. GitHub Desktop 會列出全部檔案，直接先 `Commit to main`
5. 再按 `Publish repository`
6. Remote repository 名稱用 `CT`
7. Publish 完後，到 GitHub 網頁的 repository `Settings -> Pages`
8. `Build and deployment` 的來源改成 `GitHub Actions`

如果你已經有 GitHub 上的 `CT` repository，只要把這個本機資料夾連上去，直接 commit + push 就可以。

## GitHub Pages

你可以用 GitHub Actions 發佈這個專案。Workflow 會把這些檔案複製到 `dist/` 再部署：

- `index.html`
- `app.js`
- `styles.css`
- `data/`
- `.nojekyll`

### 最短流程

1. 在 GitHub 建立一個 repository
2. 把這個資料夾內容推上去，讓 `index.html` 位於 repository 根目錄
3. 到 repository 的 `Settings -> Pages`，把 `Build and deployment` 的來源改成 `GitHub Actions`
4. 推送到 `main` 後，GitHub Actions 會自動發佈
5. 取得 `https://<user>.github.io/<repo>/` 這個網址

### 本機重新產生切片

如果 ISO 還掛在 `L:\`，可以在本機重新生成切片：

```powershell
python .\build_viewer.py --source L:\ --out .\data
```

注意：`build_viewer.py` 不要放到 GitHub Pages 的 build step，因為 GitHub Actions 上沒有你的本機 `L:\` 掛載。

## Google Sites

GitHub Pages 上線後，回到 Google Sites：

1. `Insert` -> `Embed`
2. 選 `By URL`
3. 貼上 GitHub Pages 的網址
4. 或者用 `Full page embed` 做成獨立頁面

如果 iframe 顯示空白，改成直接連結按鈕也可以。
如果你在 Google Sites 看到網站無法嵌入，通常是瀏覽器或目標網站的 frame 限制，這時就改用連結，不要硬嵌。
如果這份影像含有病患識別資訊，請不要直接公開部署；GitHub Pages 和 Google Sites 預設都屬於可被轉分享的前端展示層。

## 資料量

目前這份 viewer 約 `1587` 個檔案，總量約 `118 MB`，適合放在 GitHub Pages / Google Sites 的前端嵌入流程。
