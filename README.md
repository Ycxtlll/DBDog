<p align="center">
  <img src="public/logo.png" alt="DBDog" width="128" />
</p>

<h1 align="center">DBDog</h1>

<p align="center">
  <b>A lightweight, offline-first database GUI client</b><br>
  MySQL · Memcached · ZooKeeper
</p>

> English | [简体中文](docs/README.zh.md)

[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/Ycxtlll/DBDog/releases)
[![Made with Tauri](https://img.shields.io/badge/made%20with-Tauri-ffc131?logo=tauri)](https://tauri.app)

## Download

Download the latest version from [GitHub Releases](https://github.com/Ycxtlll/DBDog/releases).

Available for **Windows**, **macOS**, and **Linux**.

## How to Use

1. **Add a connection** — Click the <kbd>+</kbd> button in the sidebar, choose MySQL / Memcached / ZooKeeper, and fill in your server info.
2. **Browse your data** — MySQL: schema tree + SQL editor with result grid. Memcached: key list with search. ZooKeeper: node tree browser.
3. **Edit inline** — Double-click any cell in the MySQL result grid to edit data directly.
4. **Export** — Right-click on results to export as CSV / JSON / SQL.

No account or internet connection required. All data stays on your machine.

## Features

- **MySQL** — SQL editor with syntax highlighting and formatting, editable result grid (inline cell editing), schema browser
- **Memcached** — Key list browsing, search, view values, delete, flush all
- **ZooKeeper** — Node tree browser, read-only node data viewer, server statistics

See [docs/features.md](docs/features.md) for details.

## Development

```bash
npm install
npm run tauri dev
```

Requires Node.js ≥ 18 and Rust ≥ 1.78.

## Documentation

- [Changelog](docs/changelog.md)
- [Features](docs/features.md)
- [Architecture](docs/archiecture.md)

## Contributing

This is a personal side project. Issues and PRs are welcome, but response times may vary.

## License

GPLv3
