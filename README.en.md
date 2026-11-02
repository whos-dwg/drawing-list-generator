<div align="center">

![Drawing List Generator — From drawings, to a ready list](docs/assets/cover.png)

# Drawing List Generator

**Read AutoCAD title blocks, review drawing classifications, and generate a drawing list using your Excel template.**

![Version v8.12](https://img.shields.io/badge/version-v8.12-1845B9)
![Windows](https://img.shields.io/badge/platform-Windows-555555)
![AutoCAD 2021 validated](https://img.shields.io/badge/AutoCAD-2021%20validated-237A57)
[![MIT License](https://img.shields.io/badge/license-MIT-1845B9)](LICENSE)

[繁體中文](README.md) · [Download v8.12](https://github.com/whos-dwg/drawing-list-generator/releases/tag/v8.12) · [Quick start](#quick-start) · [Release notes](docs/releases/v8.12.en.md) · [Architecture](docs/ARCHITECTURE.md)

</div>

Drawing List Generator is a Windows tool for architecture, interior design, and drafting teams. Select DWG files and an Excel template, scan paper-space layout title blocks, resolve validation issues, and download the resulting drawing list.

The application processes files locally through a service bound to `127.0.0.1:4310`. A content-based scan cache allows repeated scans to reuse results.

> The original release documentation identifies AutoCAD 2021 as validated. Version-specific scanners for 2018 and 2026 are included but await device testing. This documentation pass reran the core tests; it did not revalidate AutoCAD, Excel, or the launcher.

## Download v8.12

| Download | Link |
| --- | --- |
| Windows portable package (about 36.7 MB) | [Download DrawingList-Generator-v8.12-Windows-Portable.zip](https://github.com/whos-dwg/drawing-list-generator/releases/download/v8.12/DrawingList-Generator-v8.12-Windows-Portable.zip) |
| File integrity | [SHA256SUMS.txt](https://github.com/whos-dwg/drawing-list-generator/releases/download/v8.12/SHA256SUMS.txt) |
| Changes and compatibility | [v8.12 Release](https://github.com/whos-dwg/drawing-list-generator/releases/tag/v8.12) |

Extract the entire package and double-click `DrawingList.exe`. Node.js is bundled; AutoCAD, desktop Excel, and the ACE Provider for XLS export remain external requirements. GitHub's automatic Source code archive does not include the portable launcher or runtime.

SHA-256 of the portable ZIP:

~~~text
1332be3c72573801f3188b3a4071a7423cb6592b978d0e8416d6cacfe16f10b7
~~~

In PowerShell, run `Get-FileHash -Algorithm SHA256 '.\DrawingList-Generator-v8.12-Windows-Portable.zip'` to compare your download. The [GitHub Actions core test run](https://github.com/whos-dwg/drawing-list-generator/actions/runs/41040169867) passed. See the requirements below for the limits of AutoCAD and Excel validation.

## Contents

- [Download v8.12](#download-v812)
- [Features](#features)
- [What changed in v8.12](#what-changed-in-v812)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Output example](#output-example)
- [Configuration and limits](#configuration-and-limits)
- [Development](#development)
- [Local data and support](#local-data-and-support)
- [License and credits](#license-and-credits)

## Features

- Select multiple DWG files, including files added from different folders. Scans run sequentially.
- Read attributes from `A1_TITLE_EN` blocks placed directly in paper-space layouts.
- Classify drawings using title keywords and drawing-number codes.
- Review conflicts, assign categories manually, confirm OTHER DRAWINGS, or exclude layouts.
- Block generation for duplicate drawing numbers, missing required data, and unconfirmed categories.
- Preview categories, drawing rows, blank separators, and target Excel cells.
- Export `.xls` or `.xlsx` using the corresponding template format.
- Retrieve failure diagnostics by scan ID.

## What changed in v8.12

Layout-dependent drawing-number corrections remain automatic and no longer appear as user-facing warnings. Actionable validation issues remain visible. See the [release notes](docs/releases/v8.12.en.md) and [changelog](CHANGELOG.md).

## Requirements

| Component | Requirement |
| --- | --- |
| OS | Windows |
| AutoCAD | Local Core Console and matching scanner DLL; 2021 is the original validated target |
| AutoCAD 2018 / 2026 | Scanner files included; full behavior awaits device testing |
| XLSX export | Desktop Microsoft Excel at `C:\Program Files\Microsoft Office\Root\Office16\EXCEL.EXE`, as currently coded |
| XLS export | `Microsoft.ACE.OLEDB.12.0` and desktop Excel COM; provider architecture must match PowerShell |
| Node.js | Bundled in the portable asset; Node.js 24 can run the source application |
| Input | Compatible DWGs and your own Excel template |

AutoCAD, Excel, and the ACE Provider are external dependencies. No sample DWG or Excel template is included.

## Quick start

### Portable Windows download

1. Download **DrawingList-Generator-v8.12-Windows-Portable.zip** from this repository's Releases.
2. Extract the entire archive to a writable folder. Keep `DrawingList.exe`, `app`, and `runtime` together.
3. Double-click `DrawingList.exe`.
4. Select DWGs and an Excel template. Set DRAWING SIZE and CURRENT BATCH.
5. Click **SCAN DRAWINGS** and review the results.
6. Resolve blocking issues, then click **GENERATE DRAWING LIST**.

Green means automatic classification; blue means manual assignment; amber means confirmation is required. Use **CONFIRM OTHER** when OTHER DRAWINGS is the intended category.

GitHub's automatic Source code archive does not include the portable runtime and launcher.

### Run the source

From the repository root:

~~~powershell
cd app
npm start
~~~

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). No npm packages are currently declared, so `npm install` is unnecessary. AutoCAD and Excel operations still require the Windows dependencies above.

## Output example

The [synthetic sample](examples/sample-scan.json) produces these default rows through the core preview logic. This is a data example, not a real CAD scan or exported workbook.

| Excel row | Drawing Number | Drawing Title | Size | Current Batch |
| --- | --- | --- | --- | --- |
| 9 | | PLANS & ELEVATIONS | | |
| 10 | L2-A-P1-001 | GENERAL ARRANGEMENT PLAN | A1 | v |
| 11 | | | | |
| 12 | | DETAILS | | |
| 13 | L2-A-DW-003 | WALL FINISH DETAIL | A1 | v |

Category and blank rows count toward output offsets.

## Configuration and limits

The default worksheet is `Drawing List`. Output starts at A9, B9, C9, and D9. ADMIN SETTINGS lets users edit worksheet, cell, and token formula values for the current page session.

The scanner currently hard-codes `A1_TITLE_EN`. Editing `titleBlockName` in a preset does not change scanner behavior. The JSON under `app/presets/` is a reference copy; the server imports `defaultPreset` from `app/core.mjs`.

The scanner processes paper-space layouts and does not recursively inspect nested blocks or xrefs. The layout-number correction handles particular CTAB naming patterns, rather than evaluating every AutoCAD Field.

Exports reuse template structure but apply **Verdana 15pt** to drawing rows. The XLS writer also styles category rows across A:L. XLS revision mode merges old and current drawings using fixed column and row assumptions; its final output can contain rows absent from the current-input web preview.

With multiple AutoCAD versions installed, the worker tries newer detected versions first. The UI does not currently expose a version selector.

Detailed [usage](docs/USAGE.zh-TW.md), [configuration](docs/CONFIGURATION.zh-TW.md), and [troubleshooting](docs/TROUBLESHOOTING.zh-TW.md) are available in Traditional Chinese.

## Development

~~~powershell
cd app
npm test
~~~

On 2026-10-30, all **9 existing core tests passed** under Node.js v24.18.0. They cover classification, confirmation, grouping, and drawing-number normalization. They do not cover AutoCAD binaries, the launcher, or Excel integration.

The project uses Node.js, browser JavaScript, PowerShell, and an AutoCAD .NET scanner. Precompiled scanner DLLs are retained from the supplied package. Launcher source and CAD project files were absent, so a complete binary rebuild is not available from this repository.

See [architecture](docs/ARCHITECTURE.md) and [contribution guidelines](CONTRIBUTING.md).

## Local data and support

`app/scan-cache/` may contain project attributes. Failure logs under `logs/cad-diagnostics/` may include filenames, paths, and CAD console output. Successful scan logs are removed automatically. The original release notes identify `logs/DrawingList.log` as the launcher log.

Use Issues for ordinary problems. Remove project and personal information before attaching logs. See [SECURITY.md](SECURITY.md) for private reporting guidance.

Maintainer: [whos-dwg](https://github.com/whos-dwg).

## License and credits

[MIT License](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

README structure draws on the examples collected by [matiassingers/awesome-readme](https://github.com/matiassingers/awesome-readme).
