# DBDog

A powerful, cross-platform database GUI tool built with Tauri 2.x.

**Fast SQL querying. Smart autocomplete. Beautiful design.**

## Features

- **MySQL & MariaDB** support (Redis, Memcached, ZooKeeper coming soon)
- **Schema-aware autocomplete** — databases, tables, columns with dot notation
- **Virtual scrolling data grid** — handles millions of rows smoothly
- **ER diagram auto-generation** — visualize foreign key relationships
- **EXPLAIN visualizer** — color-coded query plan analysis
- **Schema diff** — compare databases, generate migration SQL
- **Command palette** (Ctrl+K) — keyboard-first navigation
- **Query history** — auto-logged with stats, searchable, replayable
- **Query bookmarks** — save queries with `:param` placeholders
- **SQL formatter** — one-click pretty-print
- **Connection health** — process list, server variables, InnoDB status
- **Dark & Light themes** with Chinese and English UI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri 2.x |
| Frontend | React 19 + TypeScript 5 + Vite 7 |
| Backend | Rust (sqlx, tokio, dashmap) |
| SQL Editor | CodeMirror 6 |
| Data Grid | AG Grid Community |
| State | Zustand |
| i18n | react-i18next |
| Icons | lucide-react |

## Getting Started

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+ and pnpm
- [Tauri 2.x prerequisites](https://tauri.app/start/prerequisites/)

### Install & Run

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

## Development

See [DEVPLAN.md](DEVPLAN.md) for the full development roadmap and [CLAUDE.md](CLAUDE.md) for project guidelines.

## License

See [LICENSE](LICENSE) for details.
