# Sample I/O and Unsigned Windows Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe folder-based `.in/.out` import/export and complete unsigned Windows x64 smoke/release automation without changing other StarCode features.

**Architecture:** Keep filesystem dialogs and file I/O in the Electron main process. Put deterministic pairing, sanitizing, import, and export logic in a focused module, expose typed IPC through preload, and keep suite merge/persistence in `App`. Extend the existing Forge/GitHub Actions pipeline with executable package verification, Windows launch smoke testing, deterministic release asset collection, checksums, and tag-only publication.

**Tech Stack:** Electron 43, React 19, TypeScript 5, Zod 4, Vitest 4, Playwright, Electron Forge, PowerShell, GitHub Actions.

## Global Constraints

- Import scans only the selected directory's first level and pairs case-insensitive matching `.in/.out` stems.
- Missing, duplicate, or unreadable pairs are skipped and summarized; valid pairs continue.
- Imported cases append with UUIDs and `timeoutMs: 2000`, then persist automatically.
- Export is UTF-8, sanitizes cross-platform filenames, handles Windows device names, and never overwrites files.
- Windows x64 artifacts remain unsigned; no signing variables, secrets, or certificate logic may be introduced.
- `workflow_dispatch` builds artifacts only; `v*` tags additionally publish a GitHub Release.
- Renderer keeps Node isolation and never receives arbitrary filesystem access.

---

### Task 1: Sample file pairing and export rules

**Files:**
- Create: `src/main/services/sample-file-io.ts`
- Create: `tests/sample-file-io.test.ts`

**Interfaces:**
- Produces: `importTestCasesFromDirectory(directory: string): Promise<TestImportResult>`
- Produces: `exportTestCasesToDirectory(directory: string, suite: TestSuiteV1): Promise<TestExportResult>`
- Produces: `sanitizeSampleBaseName(name: string): string`

- [ ] **Step 1: Write failing tests for natural order and case-insensitive pairing**

Create temporary files `1.in/1.out`, `10.IN/10.OUT`, `2.In/2.oUt`; assert imported names are exactly `['1', '2', '10']`, contents are unchanged, and timeout is 2000.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/sample-file-io.test.ts`

Expected: FAIL because `sample-file-io.ts` does not exist.

- [ ] **Step 3: Implement minimal import pairing**

Define normalized stem records, `Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })`, UTF-8 reads, UUID generation, and issue results for missing or duplicate sides.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/sample-file-io.test.ts`

Expected: PASS for pairing and ordering.

- [ ] **Step 5: Write failing tests for issues and collision-safe export**

Cover missing input/output, duplicate case-insensitive input, invalid characters, `CON`, empty names, existing `sample.in`, and two suite names sanitizing to the same base. Assert existing files remain unchanged and output names receive `-2`/`-3`.

- [ ] **Step 6: Run tests and verify RED**

Run: `npx vitest run tests/sample-file-io.test.ts`

Expected: FAIL on missing export and issue behavior.

- [ ] **Step 7: Implement export with rollback**

Use exclusive file creation (`flag: 'wx'`), reserve both names before writing a pair, track created paths, and remove only files created by the failed call before rethrowing.

- [ ] **Step 8: Run focused and full unit tests**

Run: `npx vitest run tests/sample-file-io.test.ts && npm test`

Expected: all tests pass.

### Task 2: Typed main-process service and IPC

**Files:**
- Create: `src/main/services/sample-file-service.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload.ts`
- Modify: `tests/project-and-security.test.ts`

**Interfaces:**
- Produces: `TestImportIssue`, `TestImportResult`, `TestExportEntry`, `TestExportResult`
- Produces: `StarCodeApi.tests.importFiles()` and `StarCodeApi.tests.exportFiles(suite)`
- Produces IPC channels `TEST_IMPORT_FILES` and `TEST_EXPORT_FILES`

- [ ] **Step 1: Write failing schema and contract tests**

Add assertions that malformed import/export result objects and invalid suites are rejected by exported schemas, while valid structured results are accepted.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/project-and-security.test.ts`

Expected: FAIL because result schemas and contracts are absent.

- [ ] **Step 3: Add types, schemas, dialog service, IPC, and preload forwarding**

`SampleFileService` calls `dialog.showOpenDialog({ properties: ['openDirectory'] })`; cancellation returns `{ cancelled: true, ... }`. IPC accepts no directory path from Renderer and validates `suite` with `testSuiteSchema`.

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npx vitest run tests/project-and-security.test.ts tests/sample-file-io.test.ts`

Expected: PASS.

### Task 3: Sample panel import/export experience

**Files:**
- Modify: `src/renderer/components/TestPanel.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/test-panel.test.ts`
- Modify: `e2e/full-workflow.spec.ts`

**Interfaces:**
- `TestPanel` consumes `busy`, `onImport`, and `onExport` props.
- `App` merges imported cases, saves the resulting suite, and formats summaries.

- [ ] **Step 1: Write failing component tests**

Assert “导入” and “导出” buttons render; export is disabled for zero cases; both are disabled when `busy`; button clicks call real callback props.

- [ ] **Step 2: Run component test and verify RED**

Run: `npx vitest run tests/test-panel.test.ts`

Expected: FAIL because buttons and props do not exist.

- [ ] **Step 3: Implement panel controls and App callbacks**

Use `FolderInput`/`FolderOutput` icons. Import calls main process, appends returned cases, saves the exact merged suite, resets stale test results, and shows a toast summary. Export passes the current suite and displays the exported count/directory. Cancellation is silent.

- [ ] **Step 4: Extend E2E without automating native dialogs**

Assert the controls are visible, export is disabled before a case exists, enabled after adding a case, and disabled while sample execution is active.

- [ ] **Step 5: Run component tests, typecheck, and the workflow E2E**

Run: `npm run typecheck && npx vitest run tests/test-panel.test.ts && npm run package && npx playwright test e2e/full-workflow.spec.ts --reporter=line`

Expected: PASS.

### Task 4: Release asset verification and Windows smoke entry

**Files:**
- Create: `scripts/verify-windows-package.mjs`
- Create: `scripts/smoke-windows.ps1`
- Create: `scripts/prepare-release-assets.mjs`
- Create: `tests/release-scripts.test.ts`
- Modify: `package.json`

**Interfaces:**
- CLI: `node scripts/verify-windows-package.mjs <packaged-app-dir> <make-dir>`
- CLI: `node scripts/prepare-release-assets.mjs <download-dir> <release-dir>`
- CLI: `powershell -File scripts/smoke-windows.ps1 -PackagedAppDir <path> -MakeDir <path>`

- [ ] **Step 1: Write failing CLI behavior tests**

Build fake Windows and macOS artifact trees. Assert verifier fails when `gdb.exe` is missing and succeeds when all required paths exist. Assert release preparation copies only Setup/DMG/ZIP and writes literal SHA-256 lines for each copied file.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/release-scripts.test.ts`

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Implement Node verification and release collection scripts**

Use only Node built-ins. Resolve artifacts recursively, reject missing or ambiguous required assets, copy them to a clean output directory, and hash streamed file contents.

- [ ] **Step 4: Implement PowerShell launch smoke script**

Call the Node verifier, start only the packaged `StarCode.exe`, wait five seconds, fail if it exited early, and in `finally` terminate only the captured process tree.

- [ ] **Step 5: Add npm commands and run tests**

Add `test:smoke:windows` and `release:prepare`. Run: `npx vitest run tests/release-scripts.test.ts && npm run typecheck`.

Expected: PASS on macOS for Node behavior; PowerShell launch is exercised by Windows CI.

### Task 5: GitHub Actions unsigned publication and final verification

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`

**Interfaces:**
- Tag `v*` produces GitHub Release assets: Windows Setup, macOS DMG, macOS ZIP, `SHA256SUMS.txt`.
- Manual dispatch produces Actions artifacts only.

- [ ] **Step 1: Update workflow permissions and Windows verification**

Use read-only default contents permission. After Windows `make`, call the PowerShell smoke command with `out/StarCode-win32-x64` and `out/make`, then upload build outputs and source archives.

- [ ] **Step 2: Add tag-only publish job**

Download both build artifacts, run `prepare-release-assets.mjs`, and execute `gh release create "$GITHUB_REF_NAME" release-assets/* --generate-notes --title "$GITHUB_REF_NAME"` with job-level `contents: write` and `GH_TOKEN: ${{ github.token }}`.

- [ ] **Step 3: Document import/export, unsigned status, release behavior, and real-Windows command**

State explicitly that release assets are unsigned and Windows users may see a reputation warning.

- [ ] **Step 4: Run complete verification**

Run: `npm run typecheck && npm test && npm run package && npx playwright test --reporter=line && npm run make`.

Expected: typecheck passes, all Vitest and Playwright tests pass, macOS DMG/ZIP are generated, and no signing prompt occurs.

- [ ] **Step 5: Inspect final artifacts and launch packaged macOS app**

Verify `out/make/StarCode-macOS-arm64.dmg` and ZIP exist. Launch `out/StarCode-darwin-arm64/StarCode.app` and visually confirm the sample import/export controls are usable.
