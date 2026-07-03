# DBDog

> [English](../README.md) | 简体中文

[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/leexp/dbdog)
[![Made with Tauri](https://img.shields.io/badge/made%20with-Tauri-ffc131?logo=tauri)](https://tauri.app)
[![DeepSeek](https://img.shields.io/badge/powered%20by-DeepSeek-4D6BFE)](https://deepseek.com)

## 为什么写这个

经常跟数据库打交道，想要一个轻量的本地客户端——不联网、不需要账号、Windows/macOS/Linux 都能跑。Tauri + React 挺合适的。

## 能干什么

- **MySQL**：SQL 编辑器（高亮 + 格式化）、结果表格（支持双击内联编辑）、库表结构浏览
- **Memcached**：Key 列表浏览、搜索、查看 value、删除、Flush All
- **ZooKeeper**：节点树浏览、只读查看节点数据、服务器统计

详见 [features.md](features.md)。

## 跑起来

```bash
npm install
npm run tauri dev
```

需要 Node.js ≥ 18、Rust ≥ 1.78。

## 参与

自己写着玩的项目，欢迎提 Issue 和 PR，但回复不一定及时。

## 推荐

- [DeepSeek](https://deepseek.com) V4 确实好用。

- 另外推荐 [oh-my-pi](https://github.com/can1357/oh-my-pi) —— 能很好的完成我给的目标，同样的模型下生成的内容bug更少。

## 协议

GPLv3
