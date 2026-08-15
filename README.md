# StarCode

StarCode 是一个面向信息学奥赛训练的轻量 C++ 桌面编辑器。首个 MVP 支持 Windows x64 和 macOS arm64，提供源码编辑、编译、交互运行、图形调试和多组样例测试。

## 当前功能

- Monaco C++ 编辑器、标签页、文件树、保存和常用快捷键。
- clangd 智能提示：补全、参数提示、悬停、定义、引用、重命名、文档符号和实时诊断。
- clang-format 全文/选区格式化，可选保存时格式化；默认采用 4 空格竞赛风格。
- 单文件快速编译，以及由 `.starcode/project.json` 管理的简单多文件项目。
- C++11/14/17/20/23；默认 C++17，Release 与 Debug 两套参数。
- 内置终端、标准输入、停止进程、实时运行时间和编译诊断跳转。
- DAP 调试：断点、继续、暂停、单步、调用栈、局部变量和监视表达式。
- 多组样例保存与批量运行，支持文件夹内同名 `.in/.out` 批量导入、无覆盖导出、隐藏空输入预热、超时、运行错误、答案差异和独立于编译阶段的执行耗时。
- 统一设置中心、浅色/深色主题和可拖动调整高度的底部面板。
- macOS 随应用提供常用竞赛标准库组成的 `bits/stdc++.h` 兼容头。

## 开发

要求 Node.js 24。macOS 需要 Apple Command Line Tools；Windows 开发版可以使用系统 GCC/GDB，正式打包前应准备内置工具链。

```bash
npm install
npm start
```

常用检查：

```bash
npm run typecheck
npm test
npm run package
```

Windows x64 工具链准备命令只能在 Windows 上运行：

```powershell
npm run toolchain:windows
```

它会校验 `resources/toolchains/toolchain-lock.json`，安装锁定的 GCC、GDB、clangd、clang-format 及依赖，并复制到 `resources/toolchains/windows-x64`。正式发行时添加 `-- --with-sources`，同时准备对应源码归档。

在 Windows 实体电脑完成 `npm run make -- --arch=x64` 后，可运行与 CI 相同的未签名发行冒烟检查：

```powershell
.\scripts\smoke-windows.ps1 -PackagedAppDir .\out\StarCode-win32-x64 -MakeDir .\out\make
```

## 使用方式

- “打开”选择训练文件夹；也可以单独打开一个 `.cpp` 文件。
- 没有项目配置时只编译当前文件。点击右上角“设置”，在“项目”页可生成 `.starcode/project.json` 并维护多文件源清单。
- F9 编译，F10 运行，F5 调试，点击行号左侧空白区域设置断点。
- `Shift+Alt+F` 格式化全文；编辑器右键菜单可格式化全文或选区。
- 样例保存在 `.starcode/tests`，编译产物保存在 `.starcode/build`。
- 样例面板的“导入”会从所选文件夹第一层按同名 `.in/.out` 追加样例；缺失配对会跳过并汇总。“导出”不会覆盖目标目录已有文件。

## 打包

`npm run make` 在当前平台生成未签名安装包。CI 分别生成 Windows x64 Setup 与 macOS arm64 DMG/ZIP；推送 `v*` 标签时会自动创建 GitHub Release，并附带 `SHA256SUMS.txt`。手动触发工作流只生成 Actions 构建产物。

当前发行物明确不做代码签名。Windows SmartScreen 或 macOS Gatekeeper 可能显示来源/信誉警告；不要通过关闭系统安全功能来规避提示。

## 安全边界

Renderer 保持 Node 隔离和 Chromium 沙箱；文件、编译器与调试器只通过受限 IPC 访问。用户编译运行的 C++ 程序本身没有操作系统级沙箱，请只运行可信代码。
