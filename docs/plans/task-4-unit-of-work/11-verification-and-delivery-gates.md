# Verification and delivery gates

[← Task 4 LAYOUT-S1 index](00-index.md) · [Migration manifest](12-migration-manifest.md)

> LAYOUT-S1 verification procedures replace duplicate in-file code mirrors. Technical READY/BLOCKED semantics are Task 4 v1.10.

## 8. TDD、完成条件与停止条件

顺序固定为：`146/91/55` baseline → 未来 test 文件写入 → 从当前 canonical 自包含反向重建 v1.8 并执行 T4R-27 精确 RED → 既有回归基线 → 三个生产文件最小 GREEN → refactor → scripted 聚焦 → 真实 PostgreSQL 全量 → build/typecheck/unit → `149/91/58` scope/hash/Secret/resource → 文档同步。T4R-27 RED 必须先证明两处反向替换命中各 1、v1.8 冻结文件 `24624/878/4BE97A…`、scan `{ kind: "ok" }`、SQLPOL51 连续两次 matched 1/failed 1 且唯一原因 delegate 0→1，再证明批量 failed IDs 51～55、passed IDs 56～57、其他错误 0；不能只判断非零 exit code。恢复 v1.10 canonical 后必须证明 SQLPOL51～55 reject/delegate 0、SQLPOL56～57 allow/delegate 1。任何精确 RED 未证明、环境错误混入、拒绝目标 delegate 非 0、业务数据修改 CTE 或只读 pg_settings CTE误报、allowlist/set_config/pg_settings/WITH 合同失败、strict 非 0、过滤器未匹配、真实 PostgreSQL 未通过、范围漂移、锁文件漂移、Secret/TEMP 残留或 release/outcome 倒退都必须停止为 BUILDING/BLOCKED，不得标记 VERIFIED。

## T4R-26 Step-filter mechanical validator

The following TEMP-only validator extracts the declared and command filters from Steps 8–26, expands both against the 23 real canonical LEX titles and requires an exact partition.

```powershell
$projectRoot = (Get-Location).Path
$planRoot = Join-Path $projectRoot 'docs/plans/task-4-unit-of-work'
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$integrationParts = @(
  'fragments/03-unit-of-work.spec.ts.md',
  'fragments/05-unit-of-work.integration.spec.part-01.ts.md',
  'fragments/05-unit-of-work.integration.spec.part-02.ts.md',
  'fragments/05-unit-of-work.integration.spec.part-03.ts.md',
  'fragments/05-unit-of-work.integration.spec.part-04.ts.md'
)
$assembled = [Text.StringBuilder]::new()
foreach ($part in $integrationParts) {
  $text = $utf8.GetString([IO.File]::ReadAllBytes((Join-Path $planRoot $part)))
  $target = [regex]::Escape('apps/platform/test/database/unit-of-work.integration.spec.ts')
  $pattern = '<!-- XHT-CANONICAL-BEGIN target="' + $target + '" sequence="\d+" -->\r?\n\x60{3}ts\r?\n([\s\S]*?)\r?\n\x60{3}\r?\n<!-- XHT-CANONICAL-END target="' + $target + '" sequence="\d+" -->'
  $match = [regex]::Matches($text, $pattern)
  if ($match.Count -ne 1) { throw "LEX_CANONICAL_COUNT:${part}:$($match.Count)" }
  [void]$assembled.Append($match[0].Groups[1].Value + "`n")
}
$titles = [regex]::Matches(
  $assembled.ToString(),
  "(?m)it\(['`"](LEX(?:0[1-9]|1[0-9]|2[0-3]):[^'`"`r`n]+)['`"]"
) | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
if ($titles.Count -ne 23) { throw "LEX_TITLE_COUNT:$($titles.Count)" }

$stepText = @(
  $utf8.GetString([IO.File]::ReadAllBytes((Join-Path $planRoot '04-implementation-steps-01-20.md'))),
  $utf8.GetString([IO.File]::ReadAllBytes((Join-Path $planRoot '05-implementation-steps-21-40.md')))
) -join "`n"
$allActual = [Collections.Generic.List[string]]::new()
$identical = 0
$empty = 0
foreach ($step in 8..26) {
  $blockPattern = '(?ms)^- \[ \] \*\*Step ' + $step + ':\*\*(.*?)(?=^- \[ \] \*\*Step |\z)'
  $block = [regex]::Matches($stepText, $blockPattern)
  if ($block.Count -ne 1) { throw "STEP_BLOCK_COUNT:${step}:$($block.Count)" }
  $declared = [regex]::Matches($block[0].Groups[1].Value, '声明过滤器 `([^`]+)`')
  $command = [regex]::Matches($block[0].Groups[1].Value, "-t '([^']+)'")
  if ($declared.Count -ne 1 -or $command.Count -ne 1) {
    throw "STEP_FILTER_COUNT:${step}:declared=$($declared.Count):command=$($command.Count)"
  }
  $declaredIds = @($titles | Where-Object { $_ -match $declared[0].Groups[1].Value } | ForEach-Object { ($_ -split ':', 2)[0] })
  $actualIds = @($titles | Where-Object { $_ -match $command[0].Groups[1].Value } | ForEach-Object { ($_ -split ':', 2)[0] })
  if ($actualIds.Count -eq 0) { $empty += 1 }
  foreach ($id in $actualIds) { $allActual.Add($id) }
  $same = (($declaredIds -join ',') -ceq ($actualIds -join ','))
  if ($same) { $identical += 1 }
  "Step $step|declared=$($declaredIds -join ',')|actual=$($actualIds -join ',')|IDENTICAL=$same"
}
$union = @($allActual | Sort-Object -Unique)
$duplicate = @($allActual | Group-Object | Where-Object Count -gt 1).Count
if ($identical -ne 19 -or $union.Count -ne 23 -or $duplicate -ne 0 -or $empty -ne 0) {
  throw "LEX_STEP_GATE:identical=$identical:union=$($union.Count):duplicate=$duplicate:empty=$empty"
}
"19/19 STEP-FILTER IDENTICAL|union=23/23|duplicate=0|empty=0"
```

Step 50 and the final 23-title LEX filter remain independent full-suite gates; they do not substitute for the per-step validator above.

## T4R-27 self-contained v1.8 RED reconstruction

This command uses only the current project, canonical fragments and the embedded reverse delta. The historical v10 package is not an input. It copies the existing project shape into a verified system-TEMP root, reconstructs the five canonical v1.10 targets, proves the exact v1.8 reverse delta, distinguishes expected RED from environment/collection failures, restores v1.10 and proves 7/7 GREEN.

```powershell
$ErrorActionPreference = 'Stop'
$projectRoot = (Get-Location).Path
$planRoot = Join-Path $projectRoot 'docs/plans/task-4-unit-of-work'
$redRoot = Join-Path $env:TEMP 'xht-task4-t4r27-red'
$expectedPrefix = [IO.Path]::GetFullPath($env:TEMP) + [IO.Path]::DirectorySeparatorChar
if (-not [IO.Path]::GetFullPath($redRoot).StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'T4R27_UNSAFE_TEMP_ROOT'
}
if (Test-Path -LiteralPath $redRoot) { throw 'T4R27_TEMP_ALREADY_EXISTS' }
New-Item -ItemType Directory -Path $redRoot | Out-Null
$junctions = [Collections.Generic.List[string]]::new()
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$targets = @(
  @{ Path='apps/platform/src/infrastructure/database/database.ts'; Parts=@('fragments/06-database.ts.md'); Bytes=14767; SHA256='455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C' },
  @{ Path='apps/platform/test/unit/database.spec.ts'; Parts=@('fragments/04-database.spec.ts.md'); Bytes=12062; SHA256='07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC' },
  @{ Path='apps/platform/src/infrastructure/database/transaction-context.ts'; Parts=@('fragments/07-transaction-context.ts.md'); Bytes=5511; SHA256='CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C' },
  @{ Path='apps/platform/src/infrastructure/database/unit-of-work.ts'; Parts=@('fragments/01-unit-of-work.ts.md','fragments/02-callback-connection.ts.md'); Bytes=25165; SHA256='A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A' },
  @{ Path='apps/platform/test/database/unit-of-work.integration.spec.ts'; Parts=@('fragments/03-unit-of-work.spec.ts.md','fragments/05-unit-of-work.integration.spec.part-01.ts.md','fragments/05-unit-of-work.integration.spec.part-02.ts.md','fragments/05-unit-of-work.integration.spec.part-03.ts.md','fragments/05-unit-of-work.integration.spec.part-04.ts.md'); Bytes=113197; SHA256='FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789' }
)
try {
  & robocopy $projectRoot $redRoot /E /NFL /NDL /NJH /NJS /NP /XD node_modules dist coverage .git TEMP .cache cache | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "T4R27_ROBOCOPY_EXIT:$LASTEXITCODE" }
  foreach ($target in $targets) {
    $assembled = [Collections.Generic.List[byte]]::new()
    foreach ($part in $target.Parts) {
      $fragment = $utf8.GetString([IO.File]::ReadAllBytes((Join-Path $planRoot $part)))
      $targetPattern = [regex]::Escape($target.Path)
      $pattern = '<!-- XHT-CANONICAL-BEGIN target="' + $targetPattern + '" sequence="\d+" -->\r?\n\x60{3}ts\r?\n([\s\S]*?)\r?\n\x60{3}\r?\n<!-- XHT-CANONICAL-END target="' + $targetPattern + '" sequence="\d+" -->'
      $match = [regex]::Matches($fragment, $pattern)
      if ($match.Count -ne 1) { throw "T4R27_CANONICAL_COUNT:${part}:$($match.Count)" }
      $assembled.AddRange([Text.UTF8Encoding]::new($false).GetBytes($match[0].Groups[1].Value + "`n"))
    }
    $destination = Join-Path $redRoot $target.Path
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    [IO.File]::WriteAllBytes($destination, $assembled.ToArray())
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash
    if ((Get-Item -LiteralPath $destination).Length -ne $target.Bytes -or $hash -ne $target.SHA256) {
      throw "T4R27_CANONICAL_MISMATCH:$($target.Path)"
    }
  }

  $unitPath = Join-Path $redRoot 'apps/platform/src/infrastructure/database/unit-of-work.ts'
  $unitText = $utf8.GetString([IO.File]::ReadAllBytes($unitPath))
  $newFunction = @'
function updateTargetsPgSettings(
  tokens: readonly SqlToken[],
  updateIndex: number
): boolean {
  const update = tokens[updateIndex];
  if (
    update === undefined ||
    update.kind !== 'identifier' ||
    update.quoted ||
    update.text !== 'UPDATE'
  ) {
    return false;
  }
  const statementDepth = update.depth;
  let i = updateIndex + 1;
  const optionalOnly = tokens[i];
  if (
    optionalOnly !== undefined &&
    optionalOnly.kind === 'identifier' &&
    optionalOnly.depth === statementDepth &&
    !optionalOnly.quoted &&
    optionalOnly.text === 'ONLY'
  ) {
    i += 1;
  }
  if (tokens[i]?.depth !== statementDepth) return false;
  if (isIdentifier(tokens[i], 'PG_SETTINGS')) return true;
  return isIdentifier(tokens[i], 'PG_CATALOG') &&
    tokens[i + 1]?.depth === statementDepth &&
    isSymbol(tokens[i + 1], '.') &&
    tokens[i + 2]?.depth === statementDepth &&
    isIdentifier(tokens[i + 2], 'PG_SETTINGS');
}

function updatesPgSettings(tokens: readonly SqlToken[]): boolean {
  return tokens.some((_token, index) =>
    updateTargetsPgSettings(tokens, index)
  );
}
'@
  $oldFunction = @'
function updatesPgSettings(
  tokens: readonly SqlToken[],
  statement: { readonly token: SqlIdentifierToken; readonly index: number }
): boolean {
  if (statement.token.text !== 'UPDATE') return false;
  const topLevel = tokens.filter((token) => token.depth === 0);
  let i = statement.index + 1;
  if (isIdentifier(topLevel[i], 'ONLY')) i += 1;
  if (isIdentifier(topLevel[i], 'PG_SETTINGS')) return true;
  return isIdentifier(topLevel[i], 'PG_CATALOG') &&
    isSymbol(topLevel[i + 1], '.') &&
    isIdentifier(topLevel[i + 2], 'PG_SETTINGS');
}
'@
  $newFunction = $newFunction.Replace("`r`n", "`n")
  $oldFunction = $oldFunction.Replace("`r`n", "`n")
  $newCall = 'if (updatesPgSettings(tokens)) return false;'
  $oldCall = 'if (updatesPgSettings(tokens, statement)) return false;'
  $functionHits = [regex]::Matches($unitText, [regex]::Escape($newFunction)).Count
  $callHits = [regex]::Matches($unitText, [regex]::Escape($newCall)).Count
  if ($functionHits -ne 1 -or $callHits -ne 1) {
    throw "T4R27_REVERSE_HITS:function=${functionHits}:call=${callHits}"
  }
  $v18Text = $unitText.Replace($newFunction, $oldFunction).Replace($newCall, $oldCall)
  [IO.File]::WriteAllBytes($unitPath, [Text.UTF8Encoding]::new($false).GetBytes($v18Text))
  $v18Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $unitPath).Hash
  $v18Lines = [regex]::Matches($v18Text, "`n").Count
  if ((Get-Item -LiteralPath $unitPath).Length -ne 24624 -or $v18Lines -ne 878 -or
      $v18Hash -ne '4BE97A751BD02700C37E307AB57F53770261C95A09B152DAA6566DBD0E73ABEC') {
    throw "T4R27_V18_MISMATCH:bytes=$((Get-Item $unitPath).Length):lines=$v18Lines:sha=$v18Hash"
  }
  $v18Exact = Join-Path $redRoot 'unit-of-work.v1.8.exact.ts'
  [IO.File]::Copy($unitPath, $v18Exact, $true)

  $rootModules = Join-Path $redRoot 'node_modules'
  New-Item -ItemType Junction -Path $rootModules -Target (Join-Path $projectRoot 'node_modules') | Out-Null
  $junctions.Add($rootModules)
  $platformModules = Join-Path $redRoot 'apps/platform/node_modules'
  New-Item -ItemType Junction -Path $platformModules -Target (Join-Path $projectRoot 'apps/platform/node_modules') | Out-Null
  $junctions.Add($platformModules)
  foreach ($workspacePackage in @('contracts','testing')) {
    $packageDist = Join-Path $redRoot ("packages/{0}/dist" -f $workspacePackage)
    New-Item -ItemType Junction -Path $packageDist -Target (Join-Path $projectRoot ("packages/{0}/dist" -f $workspacePackage)) | Out-Null
    $junctions.Add($packageDist)
  }

  # Direct scan probe uses an instrumented TEMP copy, then restores the exact v1.8 bytes before RED.
  $probeText = $v18Text
  $probeNeedle = 'function scanCallbackSql(sqlText: string):'
  if ([regex]::Matches($probeText, [regex]::Escape($probeNeedle)).Count -ne 1) { throw 'T4R27_SCAN_EXPORT_HITS' }
  [IO.File]::WriteAllText($unitPath, $probeText.Replace($probeNeedle, 'export function scanCallbackSql(sqlText: string):'), [Text.UTF8Encoding]::new($false))
  $probePath = Join-Path $redRoot 'apps/platform/test/database/t4r27-scan-probe.spec.ts'
  $probe = @'
import { expect, it } from 'vitest';
import { scanCallbackSql } from '../../src/infrastructure/database/unit-of-work.js';
it('T4R27_SCAN_PROBE: v1.8 data-modifying CTE returns ok', () => {
  const actual = scanCallbackSql("WITH changed AS (UPDATE pg_catalog.pg_settings SET setting='on' WHERE name='transaction_read_only') SELECT 1");
  console.log('T4R27_SCAN_EVIDENCE', JSON.stringify(actual));
  expect(actual).toEqual({ kind: 'ok' });
});
'@
  [IO.File]::WriteAllText($probePath, $probe.Replace("`r`n", "`n") + "`n", [Text.UTF8Encoding]::new($false))
  $vitest = Join-Path $projectRoot 'node_modules/.bin/vitest.CMD'
  $config = Join-Path $redRoot 'vitest.config.ts'
  $savedPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $probeOutput = (& $vitest run $probePath --config $config --root $redRoot --project database -t '^T4R27_SCAN_PROBE:' --reporter verbose 2>&1 | Out-String)
  $probeExit = $LASTEXITCODE
  $ErrorActionPreference = $savedPreference
  if ($probeExit -ne 0 -or $probeOutput -notmatch 'T4R27_SCAN_EVIDENCE \{"kind":"ok"\}' -or $probeOutput -notmatch 'Tests\s+1 passed') {
    throw 'T4R27_SCAN_PROBE_FAILED'
  }
  Remove-Item -LiteralPath $probePath
  [IO.File]::Copy($v18Exact, $unitPath, $true)
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $unitPath).Hash -ne $v18Hash) { throw 'T4R27_V18_RESTORE_FAILED' }

  function Invoke-T4R27Vitest([string]$label, [string]$filter) {
    $env:XHT_TASK4_SCRIPTED_ONLY = '1'
    $log = Join-Path $redRoot ($label + '.log')
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $vitest run (Join-Path $redRoot 'apps/platform/test/database/unit-of-work.integration.spec.ts') --config $config --root $redRoot --project database -t $filter --reporter verbose 2>&1 |
      Out-File -LiteralPath $log -Encoding utf8
    $exit = $LASTEXITCODE
    $ErrorActionPreference = $savedPreference
    @{ Label=$label; Exit=$exit; Text=(Get-Content -LiteralPath $log -Raw -Encoding UTF8) }
  }
  function Assert-NoEnvironmentFailure([string]$text) {
    if ($text -match 'Failed Suites|Failed to resolve|Cannot find module|ERR_MODULE|No test|beforeAll|fixture|TS\d{4}|Transform failed|Collection Error') {
      throw 'T4R27_ENVIRONMENT_OR_COLLECTION_FAILURE'
    }
  }
  function Get-FailedIds([string]$text) {
    @([regex]::Matches($text, '(?m)^ FAIL .* > (SQLPOL\d{2}):') | ForEach-Object { $_.Groups[1].Value })
  }
  function Get-PassedIds([string]$text) {
    @([regex]::Matches($text, '(?m)^ ✓ .* > .* > (SQLPOL\d{2}):') | ForEach-Object { $_.Groups[1].Value })
  }
  function Assert-DelegateRed([hashtable]$run, [string[]]$failed, [string[]]$passed, [string]$summary) {
    Assert-NoEnvironmentFailure $run.Text
    if ($run.Exit -ne 1 -or ((Get-FailedIds $run.Text) -join ',') -cne ($failed -join ',') -or
        ((Get-PassedIds $run.Text) -join ',') -cne ($passed -join ',') -or
        $run.Text -notmatch [regex]::Escape($summary) -or
        $run.Text -notmatch 'AssertionError: expected 1 to be \+0') {
      throw "T4R27_WRONG_RED:$($run.Label)"
    }
    $otherAssertions = @([regex]::Matches($run.Text, '(?m)^AssertionError: ([^\r\n]+)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($otherAssertions.Count -ne 1 -or $otherAssertions[0] -ne 'expected 1 to be +0 // Object.is equality') {
      throw "T4R27_WRONG_RED_REASON:$($run.Label)"
    }
  }
  $red1 = Invoke-T4R27Vitest 'red-sqlpol51-run1' '^SQLPOL51:'
  $red2 = Invoke-T4R27Vitest 'red-sqlpol51-run2' '^SQLPOL51:'
  Assert-DelegateRed $red1 @('SQLPOL51') @() 'Tests  1 failed | 137 skipped (138)'
  Assert-DelegateRed $red2 @('SQLPOL51') @() 'Tests  1 failed | 137 skipped (138)'
  $redBatch = Invoke-T4R27Vitest 'red-sqlpol51-57' '^SQLPOL5[1-7]:'
  Assert-DelegateRed $redBatch @('SQLPOL51','SQLPOL52','SQLPOL53','SQLPOL54','SQLPOL55') @('SQLPOL56','SQLPOL57') 'Tests  5 failed | 2 passed | 131 skipped (138)'

  $canonicalUnit = $targets | Where-Object Path -eq 'apps/platform/src/infrastructure/database/unit-of-work.ts'
  $canonicalBytes = [Collections.Generic.List[byte]]::new()
  foreach ($part in $canonicalUnit.Parts) {
    $fragment = $utf8.GetString([IO.File]::ReadAllBytes((Join-Path $planRoot $part)))
    $targetPattern = [regex]::Escape($canonicalUnit.Path)
    $pattern = '<!-- XHT-CANONICAL-BEGIN target="' + $targetPattern + '" sequence="\d+" -->\r?\n\x60{3}ts\r?\n([\s\S]*?)\r?\n\x60{3}\r?\n<!-- XHT-CANONICAL-END target="' + $targetPattern + '" sequence="\d+" -->'
    $match = [regex]::Matches($fragment, $pattern)
    $canonicalBytes.AddRange([Text.UTF8Encoding]::new($false).GetBytes($match[0].Groups[1].Value + "`n"))
  }
  [IO.File]::WriteAllBytes($unitPath, $canonicalBytes.ToArray())
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $unitPath).Hash -ne $canonicalUnit.SHA256) { throw 'T4R27_GREEN_RESTORE_HASH' }
  $green = Invoke-T4R27Vitest 'green-sqlpol51-57' '^SQLPOL5[1-7]:'
  Assert-NoEnvironmentFailure $green.Text
  if ($green.Exit -ne 0 -or ((Get-PassedIds $green.Text) -join ',') -cne 'SQLPOL51,SQLPOL52,SQLPOL53,SQLPOL54,SQLPOL55,SQLPOL56,SQLPOL57' -or
      $green.Text -notmatch 'Tests\s+7 passed \| 131 skipped \(138\)') {
    throw 'T4R27_GREEN_GATE'
  }
  'T4R27 RED exact twice and batch; v1.10 SQLPOL51-57 7/7 GREEN'
} finally {
  Remove-Item Env:XHT_TASK4_SCRIPTED_ONLY -ErrorAction SilentlyContinue
  for ($i = $junctions.Count - 1; $i -ge 0; $i -= 1) {
    if (Test-Path -LiteralPath $junctions[$i]) { [IO.Directory]::Delete($junctions[$i]) }
  }
  if (Test-Path -LiteralPath $redRoot) {
    $resolved = [IO.Path]::GetFullPath($redRoot)
    if (-not $resolved.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'T4R27_UNSAFE_CLEANUP' }
    Remove-Item -LiteralPath $redRoot -Recurse -Force
  }
}
```

## Step 62 canonical fragment reconstruction

Authoritative checkbox: [Step 62](06-implementation-steps-41-63.md). The evidence chain is:

`canonical fragments → manifest reconstruction → frozen v11 bytes/SHA-256 → 5/5 byte-identical verification`.

```powershell
$planRoot = 'docs/plans/task-4-unit-of-work'
$targets = @(
  @{ Path='apps/platform/src/infrastructure/database/database.ts'; Parts=@('fragments/06-database.ts.md'); Bytes=14767; SHA256='455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C' },
  @{ Path='apps/platform/test/unit/database.spec.ts'; Parts=@('fragments/04-database.spec.ts.md'); Bytes=12062; SHA256='07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC' },
  @{ Path='apps/platform/src/infrastructure/database/transaction-context.ts'; Parts=@('fragments/07-transaction-context.ts.md'); Bytes=5511; SHA256='CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C' },
  @{ Path='apps/platform/src/infrastructure/database/unit-of-work.ts'; Parts=@('fragments/01-unit-of-work.ts.md','fragments/02-callback-connection.ts.md'); Bytes=25165; SHA256='A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A' },
  @{ Path='apps/platform/test/database/unit-of-work.integration.spec.ts'; Parts=@('fragments/03-unit-of-work.spec.ts.md','fragments/05-unit-of-work.integration.spec.part-01.ts.md','fragments/05-unit-of-work.integration.spec.part-02.ts.md','fragments/05-unit-of-work.integration.spec.part-03.ts.md','fragments/05-unit-of-work.integration.spec.part-04.ts.md'); Bytes=113197; SHA256='FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789' }
)
$utf8 = [Text.UTF8Encoding]::new($false, $true)
foreach ($target in $targets) {
  $assembled = [Collections.Generic.List[byte]]::new()
  foreach ($part in $target.Parts) {
    $path = Join-Path $planRoot $part
    $text = $utf8.GetString([IO.File]::ReadAllBytes($path))
    $targetPattern = [regex]::Escape($target.Path)
    $pattern = '<!-- XHT-CANONICAL-BEGIN target="' + $targetPattern + '" sequence="\d+" -->\r?\n\x60{3}ts\r?\n([\s\S]*?)\r?\n\x60{3}\r?\n<!-- XHT-CANONICAL-END target="' + $targetPattern + '" sequence="\d+" -->'
    $matches = [regex]::Matches($text, $pattern)
    if ($matches.Count -ne 1) { throw "CANONICAL_COUNT:${part}:$($matches.Count)" }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($matches[0].Groups[1].Value + "`n")
    $assembled.AddRange($bytes)
  }
  $actual = $assembled.ToArray()
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = ([BitConverter]::ToString($sha.ComputeHash($actual))).Replace('-', '') } finally { $sha.Dispose() }
  if ($actual.Length -ne $target.Bytes -or $hash -ne $target.SHA256) { throw "FROZEN_V11_MISMATCH:$($target.Path)" }
  "$($target.Path)|bytes=$($actual.Length)|sha256=$hash|IDENTICAL"
}
```

## Step 63 TypeScript strict/noEmit

Authoritative and final checkbox: [Step 63](06-implementation-steps-41-63.md). Step 63 remains the final numbered step; no higher-numbered step exists.

The command below first defines `$targets` exactly as in Step 62, then reconstructs five files in TEMP and invokes the locked TypeScript compiler.

```powershell
$projectRoot = (Get-Location).Path
$planRoot = Join-Path $projectRoot 'docs/plans/task-4-unit-of-work'
$targets = @(
  @{ Path='apps/platform/src/infrastructure/database/database.ts'; Parts=@('fragments/06-database.ts.md'); Bytes=14767; SHA256='455875591520686F6934AF827453843CAF2431FCEFED590B1B16EF8C5F46172C' },
  @{ Path='apps/platform/test/unit/database.spec.ts'; Parts=@('fragments/04-database.spec.ts.md'); Bytes=12062; SHA256='07A504B3B3FD538EFB16C2EA38659E565C76A81389A435370F9CD51B118E14EC' },
  @{ Path='apps/platform/src/infrastructure/database/transaction-context.ts'; Parts=@('fragments/07-transaction-context.ts.md'); Bytes=5511; SHA256='CA3B9B8959FF6786652A4828E85FEDCE776C961759EC57FDBE3E2649C29EDE1C' },
  @{ Path='apps/platform/src/infrastructure/database/unit-of-work.ts'; Parts=@('fragments/01-unit-of-work.ts.md','fragments/02-callback-connection.ts.md'); Bytes=25165; SHA256='A0FE55C8FD114534DC5C7B6B139A31C5E64F000200249773775504C4384A5E6A' },
  @{ Path='apps/platform/test/database/unit-of-work.integration.spec.ts'; Parts=@('fragments/03-unit-of-work.spec.ts.md','fragments/05-unit-of-work.integration.spec.part-01.ts.md','fragments/05-unit-of-work.integration.spec.part-02.ts.md','fragments/05-unit-of-work.integration.spec.part-03.ts.md','fragments/05-unit-of-work.integration.spec.part-04.ts.md'); Bytes=113197; SHA256='FF5162FDF71F9FA387BABFB4ED267983ED034641357D4835DB516D56B37B9789' }
)
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$strictRoot = Join-Path $env:TEMP 'xht-task4-step63-strict'
if (Test-Path -LiteralPath $strictRoot) { throw 'STEP63_TEMP_ALREADY_EXISTS' }
New-Item -ItemType Directory -Path $strictRoot | Out-Null
$junctions = [Collections.Generic.List[string]]::new()
try {
  # Reconstruct the same five targets using the Step 62 target manifest.
  foreach ($target in $targets) {
    $destination = Join-Path $strictRoot $target.Path
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    $assembled = [Collections.Generic.List[byte]]::new()
    foreach ($part in $target.Parts) {
      $fragment = $utf8.GetString([IO.File]::ReadAllBytes((Join-Path $planRoot $part)))
      $targetPattern = [regex]::Escape($target.Path)
      $pattern = '<!-- XHT-CANONICAL-BEGIN target="' + $targetPattern + '" sequence="\d+" -->\r?\n\x60{3}ts\r?\n([\s\S]*?)\r?\n\x60{3}\r?\n<!-- XHT-CANONICAL-END target="' + $targetPattern + '" sequence="\d+" -->'
      $match = [regex]::Matches($fragment, $pattern)
      if ($match.Count -ne 1) { throw "STEP63_SOURCE_COUNT:${part}:$($match.Count)" }
      $assembled.AddRange([Text.UTF8Encoding]::new($false).GetBytes($match[0].Groups[1].Value + "`n"))
    }
    [IO.File]::WriteAllBytes($destination, $assembled.ToArray())
  }
  [IO.File]::WriteAllText((Join-Path $strictRoot 'package.json'), '{"type":"module"}', [Text.UTF8Encoding]::new($false))
  $rootModules = Join-Path $strictRoot 'node_modules'
  New-Item -ItemType Junction -Path $rootModules -Target (Join-Path $projectRoot 'node_modules') | Out-Null
  $junctions.Add($rootModules)
  $platformModules = Join-Path $strictRoot 'apps/platform/node_modules'
  New-Item -ItemType Directory -Path (Join-Path $platformModules '@xht') -Force | Out-Null
  foreach ($entry in @(
    @('kysely', (Join-Path $projectRoot 'apps/platform/node_modules/kysely')),
    @('pg', (Join-Path $projectRoot 'apps/platform/node_modules/pg')),
    @('@xht/contracts', (Join-Path $projectRoot 'packages/contracts')),
    @('@xht/testing', (Join-Path $projectRoot 'packages/testing'))
  )) {
    $link = Join-Path $platformModules $entry[0]
    New-Item -ItemType Junction -Path $link -Target $entry[1] | Out-Null
    $junctions.Add($link)
  }
  $paths = @($targets.Path)
  $tsconfig = [ordered]@{
    extends = (Join-Path $projectRoot 'tsconfig.base.json')
    compilerOptions = [ordered]@{
      noEmit = $true
      paths = [ordered]@{
        '@xht/contracts' = @((Join-Path $projectRoot 'packages/contracts/src/index.ts').Replace('\', '/'))
        '@xht/testing' = @((Join-Path $projectRoot 'packages/testing/src/index.ts').Replace('\', '/'))
      }
    }
    include = $paths
  } | ConvertTo-Json -Depth 10
  [IO.File]::WriteAllText((Join-Path $strictRoot 'tsconfig.json'), $tsconfig, [Text.UTF8Encoding]::new($false))
  $tsc = Join-Path $projectRoot 'node_modules/.bin/tsc.CMD'
  if ((& $tsc --version) -ne 'Version 7.0.2') { throw 'STEP63_TYPESCRIPT_VERSION' }
  & $tsc -p (Join-Path $strictRoot 'tsconfig.json') --pretty false
  if ($LASTEXITCODE -ne 0) { throw "STEP63_TSC_EXIT:$LASTEXITCODE" }
} finally {
  for ($i = $junctions.Count - 1; $i -ge 0; $i -= 1) {
    if (Test-Path -LiteralPath $junctions[$i]) { [IO.Directory]::Delete($junctions[$i]) }
  }
  if (Test-Path -LiteralPath $strictRoot) { Remove-Item -LiteralPath $strictRoot -Recurse -Force }
}
```

## Focused filters

- `TXCTL0[1-9]` = 9.
- `REL0[1-5]` = 5.
- `IMM01` = 1.
- `(REL(03|04|05)|TXCTL(16|17))` = 5.
- `CLEAN01` = 1.
- `(IMM01|TXCTL25)` = 2.
- `TXCTL(0[1-9]|1[014-9]|2[0-5])` = 23.
- `LEX(0[1-9]|1[0-9]|2[0-3])` = 23.
- `SQLPOL(0[1-9]|[1-4][0-9]|50)` = 50.
- `SQLPOL(0[1-9]|[1-4][0-9]|5[0-7])` = 57.

Each applicable filter must have nonzero exact matched count, failed 0 and exit 0.

## READY/BLOCKED gate

READY requires the implementation baseline `146/91/55`, final formula `149/91/58`, all 63 steps preserved and unchecked before execution, Step 8–26 mapping 19/19 with LEX union 23/23/duplicate 0/empty 0, SQLPOL57/LEX23/future total 138, T4R-16–T4R-27 resolved in plan without external ACCEPT, self-contained exact T4R-27 RED, 7/7 v1.10 GREEN, 5/5 reconstruction identity, Step 63 strict/noEmit exit 0, exact Create 3/Modify 2/Delete 0 scope, unchanged locks, Secret 0 and resource cleanup.

BLOCKED applies to stale `122/67/55` current baseline, final-count mismatch, Step-filter mismatch, LEX union below 23/23, RED that depends on v10 or accepts arbitrary nonzero failure, v1.8 hash mismatch, environment/collection failure mixed into RED, wrong delegate failure, any source mismatch, missing step/test/T4R, false-positive ban on business data-modifying CTE, Step 62 below 5/5, Step 63 failure, dependency/sixth-engineering-file expansion, lock drift, actual engineering modification, Task 4 implementation or entry into Step 8/48.

## Document and delivery checks

- UTF-8 without BOM; balanced Markdown fences.
- Relative links valid and within project; every split file returns to `00-index.md`.
- Plan Markdown hard limits: bytes ≤ 100000 and lines ≤ 2500.
- No empty or placeholder document; no Secret/TEMP/cache/log delivery entries.
- package.json, pnpm-lock.yaml and toolchain-lock.json hashes unchanged.
- Report normalization: one field, replace only its 64 hash characters with 64 zeros, preserve actual UTF-8/LF bytes, two identical recomputations.
- ZIP/TXT never overwrite an older delivery and exclude node_modules, dist, coverage, .git, TEMP, cache, logs, test temporary files, Secrets and old deliveries.

## NOT_RERUN boundary for LAYOUT-S1

PostgreSQL, Docker, Flyway, Testcontainers, project build, project typecheck, project unit, project database and real complete 138/138 are `NOT_RERUN`. Canonical reconstruction and isolated strict/noEmit evidence are document-layout checks, not real project/database test evidence.
