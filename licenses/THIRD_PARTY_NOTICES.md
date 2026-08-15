# StarCode Third-Party Notices

StarCode 的 JavaScript 依赖许可证记录在 `package-lock.json`。正式发行前应使用依赖许可证扫描工具生成完整清单，并与本文件一同放入安装包。

## Windows C++ toolchain

Windows 发行包包含由 MSYS2 提供的 MinGW-w64 UCRT64 软件包及其运行时依赖：

- GCC 16.1.0-5，GPL-3.0-or-later with GCC Runtime Library Exception。
- GDB 17.2-1，GPL-3.0-or-later。
- LLVM/Clang、clangd 与 clang-format 22.1.8-1，Apache-2.0 WITH LLVM-exception。
- MinGW-w64、Python 及其他依赖，许可证见工具链内的 `share/licenses` 目录。

确切二进制包版本记录在 `resources/toolchains/toolchain-lock.json` 和发行包内的 `installed-packages.txt`。使用 `npm run toolchain:windows -- --with-sources` 会把对应 GCC、GDB 与 LLVM 源码归档放入 `licenses/third-party-sources`，应与二进制发行物一同提供。

MSYS2 packages: https://packages.msys2.org/

## Editor and application runtime

- Electron: MIT
- React: MIT
- Monaco Editor: MIT
- xterm.js: MIT
- node-pty: MIT
- Lucide: ISC
- Zod: MIT
- Zustand: MIT

各项目的完整许可证文本保留在 npm 安装包及其上游仓库中。本文件不是法律意见。
