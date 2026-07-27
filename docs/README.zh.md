<p align="center">
  <img src="../public/logo.png" alt="DBDog" width="128" />
</p>

<h1 align="center">DBDog</h1>

<p align="center">
  <b>轻量级、离线优先的数据库桌面客户端</b><br>
  MySQL · Memcached · ZooKeeper
</p>

> [English](../README.md) | 简体中文

[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/Ycxtlll/DBDog/releases)
[![Made with Tauri](https://img.shields.io/badge/made%20with-Tauri-ffc131?logo=tauri)](https://tauri.app)

## 下载

从 [GitHub Releases](https://github.com/Ycxtlll/DBDog/releases) 下载最新版本。

支持 **Windows**、**macOS**、**Linux** 三个平台。

## 怎么用

1. **添加连接** — 点击侧边栏的 <kbd>+</kbd> 按钮，选择 MySQL / Memcached / ZooKeeper，填好服务器信息。
2. **浏览数据** — MySQL：库表结构树 + SQL 编辑器 + 结果表格。Memcached：Key 列表 + 搜索。ZooKeeper：节点树浏览。
3. **内联编辑** — 在 MySQL 结果表格中双击单元格即可直接修改数据。
4. **导出** — 在结果上右键，支持导出为 CSV / JSON / SQL。

无需注册账号，无需联网，数据完全保存在本地。

## 能干什么

- **MySQL**：SQL 编辑器（高亮 + 格式化）、结果表格（支持双击内联编辑）、库表结构浏览
- **Memcached**：Key 列表浏览、搜索、查看 value、删除、Flush All
- **ZooKeeper**：节点树浏览、只读查看节点数据、服务器统计

详见 [features.md](features.md)。

## 开发

```bash
npm install
npm run tauri dev
```

需要 Node.js ≥ 18、Rust ≥ 1.78。

## 参与

自己写着玩的项目，欢迎提 Issue 和 PR，但回复不一定及时。

## 协议

GPLv3
