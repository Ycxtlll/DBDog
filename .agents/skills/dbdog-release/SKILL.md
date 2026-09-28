---
name: dbdog-release
description: DBDog 的提交规范与发布流程：提交信息格式、版本号 bump（含 Cargo.lock 坑）、changelog 写法、提交前检查、release 构建、推送与 PR。凡是要提交代码、bump 版本、发版、写 changelog、build release、推送分支或建 PR 时使用——即使用户只说"提交一下"、"build 个 release"、"发个版"。
---

# DBDog 提交规范与发布流程

## 提交信息规范

参照仓库既有历史（`git log --oneline`），两种提交：

- **功能/修复提交**：英文祈使句一行，不加前缀。写"做了什么"，不写文件清单。
  - 好：`Add server-side table data pagination and visual table designer`
  - 好：`Render UTF-8 blob content as text instead of base64`
  - 差：`update files`、`修复了一些问题`
- **发版提交**：`vX.Y.Z: <本版主题摘要（英文）>`，例如
  `v0.3.9: security & correctness audit fixes across backend and frontend`。
  只包含版本四件套 + changelog，不混功能代码。

习惯上一个批次拆两个提交：先功能提交（所有代码），再发版提交（版本四件套 + changelog）。

## 版本号 bump（4 处，缺一不可）

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`docs/CHANGELOG.md`。

**Cargo.lock 只能改 `name = "dbdog"` 条目下的 `version` 行。** 其他 crate
（tauri-winres、field-offset、fdeflate 等）可能与 app 同版本号，全局
replace/replaceAll 会改坏它们导致 `cargo build` 失败。用行号定位的 sed：

```bash
# 先找到行号（假设是 592/593）：
rg -n 'name = "dbdog"' -A1 src-tauri/Cargo.lock
sed -i '593s/version = "0.3.9"/version = "0.3.10"/' src-tauri/Cargo.lock
```

版本号节奏：0.x 系列内递增 patch 号（0.3.8 → 0.3.9 → 0.3.10），新增功能也走 patch。

## CHANGELOG 写法

`docs/CHANGELOG.md`，Keep a Changelog 格式 + 语义化版本，**正文用中文**。
新版本条目插在文件顶部 `---` 之后。段落用 `### Added` / `### Changed` / `### Fixed`；
每条以加粗短句开头，后接破折号详述（做了什么 + 为什么 + 关键实现细节/边界处理）。
用户可感知的功能写 `### Added`，纯样式/交互优化写 `### Changed`。日期用当天。

## 提交前检查

```bash
npm run build     # tsc + vite build —— 这是唯一的前端类型检查（无 lint、无前端测试）
cd src-tauri && cargo check
```

注意：`cargo test` 里有 `memcached_integration`，需要本机 127.0.0.1:11211 跑着
Memcached，没起服务时必然失败——不要因此卡住流程，`cargo check` 通过即可。

## Release 构建

```bash
npm run tauri build --no-bundle
```

产物（即使加了 `--no-bundle`，wix/nsis 也会一并产出）：
- 便携版：`src-tauri/target/release/dbdog.exe`
- 安装包：`src-tauri/target/release/bundle/msi/DBDog_<ver>_x64_en-US.msi`
  和 `bundle/nsis/DBDog_<ver>_x64-setup.exe`

Release 构建保留在 Windows 侧执行（不要用 wsl）。

## 推送与 PR

- 本机 **没有 gh CLI**（Windows 和 WSL 都没有），无法代建 PR；创建 PR 需要
  用户本人的 GitHub 授权。推送成功后把 GitHub 返回的
  `https://github.com/Ycxtlll/DBDog/pull/new/<branch>` 链接给用户，附上建议的
  PR 标题（英文）与描述。
- origin 已配置为 `ssh://git@ssh.github.com:443/Ycxtlll/DBDog.git`
  （HTTPS token 已失效，且 22 端口到 GitHub 会被 connection reset，必须走 443）。
- **推送失败先重试**：网络间歇性抖动，同样的命令第二三次往往就通。重试循环要
  用 git 自身退出码判断（`if git push ...; then`），管道接 tail 会吃掉退出码。
- Windows 侧 git 会报 LF→CRLF warning，无害，忽略。
