#!/usr/bin/env bash
# Radeon Cloud API 调用助手：发起一次已认证请求，并把响应体打到标准输出、
# HTTP 状态码打到标准错误，使调用方可以分别解析内容与状态。
#
# 密钥有两个来源，按优先级取用：
#   1. 环境变量 RADEON_API_KEY —— 直接给出密钥字面值，适合没有安装 DSH、
#      或不想在本机留存凭据文件的使用者；
#   2. DSH 凭据存储 ~/.dsh/.credentials.yaml 中名为 RADEON_CLOUD_API_KEY 的
#      条目（条目名可用 RADEON_KEY_REF 覆盖）—— 适合已在 DSH 的模型设置页
#      录入过密钥的使用者。
# 无论走哪个来源，密钥都只存在于本进程变量与 curl 请求头里，
# 不写盘、不打印、不出现在输出中。
#
# 用法: ./scripts/radeon-api.sh <METHOD> <PATH> [JSON_BODY]
#   RADEON_API_KEY=rc-xxxx ./scripts/radeon-api.sh GET /models
#   RAW=1 时改为逐块输出 SSE，不做缓冲与状态码拆分。

set -euo pipefail

# 凭据文件位置。DSH_HOME 未设置时回退到默认的 ~/.dsh。
CRED_FILE="${DSH_HOME:-$HOME/.dsh}/.credentials.yaml"
# 要读取的凭据条目名，可用环境变量覆盖以切换密钥。
REF="${RADEON_KEY_REF:-RADEON_CLOUD_API_KEY}"
# 共享端点基础 URL，可用环境变量覆盖以指向独占端点。
BASE="${RADEON_BASE:-https://developer.amd.com.cn/radeon/api/v1}"

# 密钥优先取环境变量；未提供时才回退到凭据文件。
# 这样在完全没有 DSH 凭据文件的机器上，仅设置 RADEON_API_KEY 即可使用。
KEY="${RADEON_API_KEY:-}"

if [[ -z "$KEY" ]]; then
  if [[ ! -f "$CRED_FILE" ]]; then
    cat >&2 <<EOF
错误：没有可用的 API 密钥。
  凭据文件 ${CRED_FILE} 不存在，且环境变量 RADEON_API_KEY 未设置。
  请任选其一：
    export RADEON_API_KEY=rc-你的密钥
    或在 DSH 的模型设置页录入密钥，条目名用 ${REF}
EOF
    exit 1
  fi
  # 从凭据文件中按条目名取出密钥值。用 node 而非 sed，
  # 是为了避免密钥值里若含特殊字符时被 shell 当作模式解释。
  KEY="$(node -e '
const fs = require("fs");
const t = fs.readFileSync(process.argv[1], "utf8");
const m = t.match(new RegExp("^\\s*" + process.argv[2] + ":\\s*(\\S+)\\s*$", "m"));
if (!m) { console.error("凭据 " + process.argv[2] + " 未设置"); process.exit(1); }
process.stdout.write(m[1]);
' "$CRED_FILE" "$REF")"
fi

# 三个位置参数依次为方法、路径（相对 BASE）、可选的请求体。
METHOD="${1:?用法: radeon-api.sh <METHOD> <PATH> [BODY]}"
P="${2:?缺少路径}"
BODY="${3:-}"

# curl 参数数组。-w 在响应体末尾追加状态码标记，供后续拆分。
args=(-sS -X "$METHOD" "$BASE$P"
  -H "Authorization: Bearer $KEY"
  -H "Content-Type: application/json"
  -w $'\n__HTTP_STATUS__%{http_code}\n')

# 流式模式：-N 关闭缓冲，响应分片一到就直接输出。
# 此模式不追加状态码标记，也不拆分响应体，调用方需自行处理。
if [[ "${RAW:-0}" == "1" ]]; then
  args=(-sSN -X "$METHOD" "$BASE$P"
    -H "Authorization: Bearer $KEY"
    -H "Content-Type: application/json"
    -H "Accept: text/event-stream")
  if [[ -n "$BODY" ]]; then
    args+=(--data-binary "$BODY")
  fi
  curl "${args[@]}"
  exit 0
fi

if [[ -n "$BODY" ]]; then
  args+=(--data-binary "$BODY")
fi

# 非流式模式：先把响应连同状态码写入临时文件，再把两者分别输出，
# 避免状态码混入 JSON 响应体导致调用方解析失败。
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl "${args[@]}" > "$tmp"

# 状态码在最后一行，剥掉标记前缀；响应体是除最后一行外的全部内容。
status="$(tail -n1 "$tmp" | sed 's/__HTTP_STATUS__//')"
body="$(sed '$d' "$tmp")"

echo "$body"
echo "---HTTP $status---" >&2