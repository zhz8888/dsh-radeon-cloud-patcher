#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
    Radeon Cloud API 调用助手（PowerShell 7 版）。

.DESCRIPTION
    与同目录的 radeon-api.sh 行为一致：发起一次已认证请求，把响应体打到标准输出、
    HTTP 状态码以 ---HTTP <code>--- 的形式打到标准错误，使调用方可以分别解析内容与状态。

    密钥有两个来源，按优先级取用：
      1. 环境变量 RADEON_API_KEY —— 直接给出密钥字面值，适合没有安装 DSH、
         或不想在本机留存凭据文件的使用者；
      2. DSH 凭据存储 ~/.dsh/.credentials.yaml 中名为 RADEON_CLOUD_API_KEY 的
         条目（条目名可用 RADEON_KEY_REF 覆盖）—— 适合已在 DSH 的模型设置页
         录入过密钥的使用者。
    无论走哪个来源，密钥都只存在于本进程变量与请求头里，
    不写盘、不打印、不出现在输出中。

    用法: ./scripts/radeon-api.ps1 <METHOD> <PATH> [JSON_BODY]
      $env:RADEON_API_KEY = 'rc-xxxx'; ./scripts/radeon-api.ps1 GET /models
      $env:RAW = '1' 时改为逐块输出 SSE，不做缓冲与状态码拆分。

.PARAMETER Method
    HTTP 方法，如 GET / POST。

.PARAMETER ApiPath
    相对端点基础 URL 的路径，如 /models。

.PARAMETER Body
    可选的 JSON 请求体。
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $Method,

    [Parameter(Position = 1)]
    [string] $ApiPath,

    [Parameter(Position = 2)]
    [string] $Body
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 统一按 UTF-8 输出：脚本里有中文，Windows 默认代码页会把它们变成乱码。
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

# 凭据文件位置。DSH_HOME 未设置时回退到默认的 ~/.dsh。
$CredFile = if ($env:DSH_HOME) {
    Join-Path $env:DSH_HOME '.credentials.yaml'
}
else {
    Join-Path $HOME '.dsh' '.credentials.yaml'
}
# 要读取的凭据条目名，可用环境变量覆盖以切换密钥。
$Ref = if ($env:RADEON_KEY_REF) { $env:RADEON_KEY_REF } else { 'RADEON_CLOUD_API_KEY' }
# 共享端点基础 URL，可用环境变量覆盖以指向独占端点。
$Base = if ($env:RADEON_BASE) { $env:RADEON_BASE } else { 'https://developer.amd.com.cn/radeon/api/v1' }

# 密钥优先取环境变量；未提供时才回退到凭据文件。
# 这样在完全没有 DSH 凭据文件的机器上，仅设置 RADEON_API_KEY 即可使用。
$Key = $env:RADEON_API_KEY

if (-not $Key) {
    if (-not (Test-Path -LiteralPath $CredFile -PathType Leaf)) {
        [Console]::Error.WriteLine(@"
错误：没有可用的 API 密钥。
  凭据文件 $CredFile 不存在，且环境变量 RADEON_API_KEY 未设置。
  请任选其一：
    `$env:RADEON_API_KEY = 'rc-你的密钥'
    或在 DSH 的模型设置页录入密钥，条目名用 $Ref
"@)
        exit 1
    }
    # 从凭据文件中按条目名取出密钥值。条目名先做正则转义，
    # 避免名字里的特殊字符被当成模式的一部分（bash 版交给 node 处理同一问题）。
    $text = Get-Content -LiteralPath $CredFile -Raw -Encoding utf8
    if ($null -eq $text) { $text = '' }
    $pattern = '(?m)^\s*' + [regex]::Escape($Ref) + ':\s*(\S+)\s*$'
    $match = [regex]::Match($text, $pattern)
    if (-not $match.Success) {
        [Console]::Error.WriteLine("凭据 $Ref 未设置")
        exit 1
    }
    $Key = $match.Groups[1].Value
}

# 三个位置参数依次为方法、路径（相对 Base）、可选的请求体。
# 与 bash 版一样在缺参时报用法并退出 1，而不是抛异常——
# 脚本被 probe-efforts.mjs 这类调用方以 execFile 拉起时，抛异常只会留下一行栈。
if (-not $Method) {
    [Console]::Error.WriteLine('用法: radeon-api.ps1 <METHOD> <PATH> [JSON_BODY]')
    exit 1
}
if (-not $ApiPath) {
    [Console]::Error.WriteLine('缺少路径')
    exit 1
}

$Uri = "$Base$ApiPath"
$IsRaw = $env:RAW -eq '1'
$Utf8 = [System.Text.UTF8Encoding]::new($false)

# 直接用 HttpClient 而不是 Invoke-WebRequest：后者会把响应整体缓冲，
# 拿不到 RAW 模式要求的「分片一到就写出」，也不能把非 2xx 当正常结果读回来。
$handler = [System.Net.Http.HttpClientHandler]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
# 与 curl 一致：不设超时。上游偶发慢响应时由调用方自己判重试。
$client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan

try {
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), $Uri)
    $request.Headers.TryAddWithoutValidation('Authorization', "Bearer $Key") | Out-Null
    if ($IsRaw) {
        $request.Headers.TryAddWithoutValidation('Accept', 'text/event-stream') | Out-Null
    }
    if ($Body) {
        $bodyContent = [System.Net.Http.StringContent]::new($Body, $Utf8)
    }
    else {
        # 无请求体时也要带上 Content-Type，与 bash 版的 -H 一致。
        # HttpClient 不允许单独设置内容头，只能挂一个空内容；
        # 代价是多一个 Content-Length: 0，对网关没有影响。
        $bodyContent = [System.Net.Http.ByteArrayContent]::new([byte[]]@())
    }
    $bodyContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/json')
    $request.Content = $bodyContent

    $stdout = [Console]::OpenStandardOutput()

    if ($IsRaw) {
        # 流式模式：响应头一到就返回，分片一到就直接写出。
        # 此模式不追加状态码标记，也不拆分响应体，调用方需自行处理。
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $buffer = [byte[]]::new(8192)
        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $stdout.Write($buffer, 0, $read)
            $stdout.Flush()
        }
        $stream.Dispose()
        $response.Dispose()
        exit 0
    }

    # 非流式模式：状态码走标准错误、响应体走标准输出，调用方才能分别解析。
    # 非 2xx 也照常输出响应体与状态码，退出码仍为 0——bash 版的 curl 没有 -f，
    # 语义相同；探针脚本正是靠 ---HTTP 4xx--- 判定「档位被拒绝」。
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $bodyText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $status = [int]$response.StatusCode
    # 末尾补一个换行，与 bash 版的 echo 一致；空响应体也补。
    $bytes = $Utf8.GetBytes("$bodyText`n")
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
    [Console]::Error.WriteLine("---HTTP $status---")
    $response.Dispose()
    exit 0
}
catch {
    [Console]::Error.WriteLine("错误：请求失败：$($_.Exception.Message)")
    exit 1
}
finally {
    $client.Dispose()
}
