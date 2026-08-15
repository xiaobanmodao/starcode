# StarCode 样例文件导入导出与未签名发行设计

## 目标

本次只开发两项能力：

1. 在现有样例面板中批量导入和导出同名 `.in/.out` 文件。
2. 完善 Windows x64 未签名安装包的检查、冒烟测试与 GitHub Release 自动发布。

不开发浮点判题、Special Judge、模板、内存统计、其他语言或代码签名。

## 样例文件规则

### 导入

- 用户从样例面板选择一个文件夹。
- 只扫描所选文件夹的第一层，不递归子目录。
- 扩展名使用不区分大小写的 `.in` 与 `.out`。
- 去除扩展名后的文件名采用不区分大小写的方式配对，例如 `Sample.IN` 可与 `sample.out` 配对。
- 文件按自然顺序处理，使 `1`、`2`、`10` 保持符合用户预期的顺序。
- 每个完整文件对转换为一个 `TestCaseV1`：
  - `id` 为新生成的 UUID；
  - `name` 为输入文件去除扩展名后的原始名称；
  - `input` 为 `.in` 的 UTF-8 内容；
  - `expectedOutput` 为 `.out` 的 UTF-8 内容；
  - `timeoutMs` 固定为 2000。
- 新样例追加到当前样例列表，不替换或修改已有样例。
- 导入完成后自动保存更新后的 `TestSuiteV1`。
- 缺少配对文件、同一标准化名称出现多个 `.in` 或多个 `.out`、文件无法读取时跳过该组；其他完整文件对继续导入。
- 用户取消文件夹选择时不改变样例，也不显示错误。
- 完成后返回结构化摘要，界面显示导入数量和被跳过项目的原因。

### 导出

- 用户从样例面板选择一个目标文件夹。
- 按样例列表顺序导出，每组生成 `<名称>.in` 与 `<名称>.out`。
- 文件名去除 Windows 与 macOS 不允许或容易产生歧义的字符，去除末尾空格与句点；Windows 保留设备名添加 `sample-` 前缀，清理后为空时使用 `sample`。
- 文件名匹配采用不区分大小写规则，以确保不同平台结果一致。
- 如果目标目录已存在同名文件，或者多个样例清理后名称相同，则依次使用 `-2`、`-3` 后缀。
- 永不覆盖目标目录中的已有文件。
- 输入和期望输出原样以 UTF-8 写入，不额外修改换行或尾部空白。
- 用户取消目录选择时不写入文件。
- 完成后返回导出数量、实际文件名与目标目录，界面显示简短成功摘要。

## 应用架构

### 主进程

新增 `SampleFileService`，它是唯一接触系统目录选择器和 `.in/.out` 文件的组件。服务使用 Electron 原生 `dialog.showOpenDialog` 获取目录，不接受 Renderer 提供的任意目录路径，从而延续现有 IPC 安全边界。

服务负责目录枚举、自然排序、配对、UTF-8 读取、文件名清理、冲突规避和写入。纯规则提取为可单元测试的导出函数。

### 数据契约

新增以下类型：

- `TestImportIssue`：包含文件基名与中文原因。
- `TestImportResult`：包含 `cancelled`、导入的 `TestCaseV1[]` 和问题列表。
- `TestExportEntry`：包含样例 ID、实际 `.in/.out` 文件名。
- `TestExportResult`：包含 `cancelled`、目标目录和导出条目。

`window.starcode.tests` 增加：

- `importFiles(): Promise<TestImportResult>`
- `exportFiles(suite: TestSuiteV1): Promise<TestExportResult>`

所有返回值和传入的 suite 继续经过 Zod schema 校验。IPC 来源继续使用现有 `validateSender` 校验。

### Renderer

样例面板工具栏增加“导入”和“导出”按钮：

- 导入成功后由 `App` 合并当前 suite、更新 store 并保存 suite；已有选择保持不变，没有选择时由面板自动选中第一项。
- 导出按钮在没有样例时禁用。
- 导入或导出的摘要使用现有应用消息方式显示；错误走统一错误处理。
- 正在编译、运行、测试或调试时禁用导入和导出，避免状态竞争。

## Windows 打包与冒烟测试

### 打包

- 继续使用 Electron Forge `MakerSquirrel` 生成 Windows x64 Setup。
- 安装包保持未签名，不读取、不声明任何证书或签名密码。
- Windows 构建继续执行锁定工具链下载与 SHA-256 校验，并包含 GCC、GDB、clangd、clang-format、依赖库、许可证和源码归档。

### 冒烟脚本

新增 PowerShell 脚本，接收打包目录并验证：

1. `StarCode.exe` 和 Squirrel Setup 均存在。
2. 应用 resources 中存在 `g++.exe`、`gdb.exe`、`clangd.exe`、`clang-format.exe` 与锁文件。
3. `app.asar` 存在，`node-pty` 原生模块位于解包资源中。
4. 启动打包后的 `StarCode.exe`，等待主进程保持运行至少五秒。
5. 结束本次启动的进程树，并确认没有由脚本启动的 StarCode 子进程残留。

脚本只操作自己启动的 PID，不结束用户已有的其他 StarCode 实例。该脚本既由 GitHub Windows runner 执行，也作为实体 Windows 电脑上的本地复验入口。

## GitHub Actions 发布流程

现有 `release.yml` 保留 Windows x64 与 macOS arm64 两个构建任务，并补充：

- Windows 任务在 `make` 后运行资源检查和启动冒烟脚本。
- 两个平台上传命名稳定的发行文件；第三方源码归档仅保留在 Actions 构建产物中，不加入最终 Release。
- 新增 `publish` 任务，仅在 `v*` 标签触发时运行。
- `publish` 下载两个平台的构建产物，收集 Windows Setup、macOS DMG 和 macOS ZIP。
- 生成包含每个发行文件 SHA-256 的 `SHA256SUMS.txt`。
- 使用 GitHub CLI 和仓库自带 `GITHUB_TOKEN` 创建对应标签的 GitHub Release、自动生成发行说明并上传发行文件。
- `workflow_dispatch` 只构建和上传 Actions artifacts，不创建 GitHub Release。
- 发布任务声明最小权限 `contents: write`；普通构建任务不需要写权限。

## 错误处理

- 目录读取失败或写入失败返回明确中文错误；导出跟踪本次新建文件，失败时删除本次已写文件，避免留下半套结果。
- 单个导入文件对的问题不终止其他配对；问题全部进入导入摘要。
- 导出使用逐文件独占创建，遇到并发产生的文件名冲突时继续增加数字后缀。
- GitHub Release 任务在缺少预期产物、校验和生成失败或上传失败时直接失败，避免发布不完整版本。
- Windows 冒烟脚本始终在 `finally` 中清理它启动的进程。

## 测试与验收

### 单元与集成测试

- 大小写不同的同名 `.in/.out` 能正确配对。
- 文件名自然排序正确。
- 缺失、重复和不可读文件形成跳过摘要。
- 导入结果只包含完整文件对，默认超时为 2000 ms。
- 文件名清理和跨平台大小写冲突处理正确。
- 导出不会覆盖已有文件，并生成递增后缀。
- 文件内容 UTF-8 往返保持一致。
- IPC schema 拒绝无效 suite 与伪造参数。

### Electron 端到端测试

- 在样例面板触发导入后，新样例出现在列表并可运行。
- 导出按钮在空 suite 时禁用。
- 导入导出按钮在前台操作期间禁用。

目录选择器本身使用主进程服务集成测试覆盖；E2E 不依赖操作系统文件选择器自动化。

### 发行验证

- macOS 当前环境完成类型检查、单元测试、Electron E2E、package 和 make。
- GitHub Windows runner 完成工具链准备、测试、打包与冒烟脚本。
- 实体 Windows 机器可使用相同 PowerShell 命令复验；当前 macOS 环境不能替代实体 Windows 的最终人工确认。

## 完成标准

- 用户能从一个目录追加导入完整的 `.in/.out` 配对，问题项被跳过并汇总。
- 用户能无覆盖地导出当前全部样例。
- 现有手工样例编辑、隐藏预热和批量运行行为不回退。
- Windows x64 未签名 Setup 通过自动资源检查与启动冒烟。
- `v*` 标签能创建包含 Windows Setup、macOS DMG/ZIP 和校验和文件的 GitHub Release。
- 不包含任何代码签名逻辑或凭据要求。
