#!/usr/bin/env bash
# 生成本地开发用的自签 TLS 证书。
#
# 为什么需要：Web Locks（navigator.locks）与 crypto.randomUUID 只在安全上下文可用。
# 用「公网 IP + 明文 HTTP」打开开发服务器时两者都不存在，生成结果落库会直接失败并
# 提示“当前浏览器不支持跨页面生成副作用互斥”。没有域名时把开发服务器切到 HTTPS
# 即可恢复；端口号不影响安全上下文判定。
#
# 用法：
#   web/scripts/dev-https-cert.sh                    # 只覆盖 localhost 与自动探测的内网地址
#   web/scripts/dev-https-cert.sh 124.222.118.32     # 追加实际访问用的 IP（或主机名）
#   web/scripts/dev-https-cert.sh --force 1.2.3.4    # SAN 变化后强制重签
#
# 证书与私钥写入 .local/certs（已被 .gitignore 忽略），不要提交或复用为生产证书。
set -euo pipefail

web_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$web_dir/.." && pwd)"
cert_dir="${CANVAS_DEV_CERT_DIR:-$repo_root/.local/certs}"
cert_file="$cert_dir/dev-cert.pem"
key_file="$cert_dir/dev-key.pem"
san_file="$cert_dir/dev-cert.san"

force=false
extra_hosts=()
for argument in "$@"; do
  case "$argument" in
    --force) force=true ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "unknown option: $argument" >&2
      exit 2
      ;;
    *) extra_hosts+=("$argument") ;;
  esac
done

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate the development certificate" >&2
  exit 1
fi

# localhost 与回环地址始终包含，保证「同机浏览器 + localhost」也能用同一份证书。
san_entries=(DNS:localhost IP:127.0.0.1 IP:::1)
seen=" DNS:localhost IP:127.0.0.1 IP:::1 "

add_san() {
  local entry=$1
  case "$seen" in
    *" $entry "*) return 0 ;;
  esac
  seen="$seen$entry "
  san_entries+=("$entry")
}

# 保留上一次已签发的 SAN：不带参数重跑不会把之前用 --force 加进去的 IP 丢掉。
if [ -f "$san_file" ]; then
  for host in $(tr ',' ' ' <"$san_file"); do
    add_san "$host"
  done
fi

if command -v hostname >/dev/null 2>&1; then
  for address in $(hostname -I 2>/dev/null || true); do
    case "$address" in
      *:*) add_san "IP:$address" ;;
      *[0-9].[0-9]*) add_san "IP:$address" ;;
    esac
  done
fi

for host in ${extra_hosts[@]+"${extra_hosts[@]}"}; do
  case "$host" in
    *[0-9].[0-9]*[0-9]) add_san "IP:$host" ;;
    *) add_san "DNS:$host" ;;
  esac
done

san_list="$(IFS=,; printf '%s' "${san_entries[*]}")"
mkdir -p "$cert_dir"

if [ "$force" = false ] && [ -s "$cert_file" ] && [ -s "$key_file" ] && [ -f "$san_file" ] && [ "$(cat "$san_file")" = "$san_list" ]; then
  echo "existing certificate already covers $san_list"
  echo "certificate: $cert_file"
  exit 0
fi

openssl req -x509 -newkey rsa:2048 -nodes -days "${CANVAS_DEV_CERT_DAYS:-825}" \
  -keyout "$key_file" -out "$cert_file" \
  -subj "/CN=open-ai-canvas-dev" \
  -addext "subjectAltName=$san_list" \
  -addext "basicConstraints=critical,CA:TRUE" >/dev/null 2>&1

chmod 600 "$key_file"
chmod 644 "$cert_file"
printf '%s' "$san_list" >"$san_file"

echo "generated development certificate"
echo "SAN: $san_list"
echo "certificate: $cert_file"
echo "key:         $key_file"
echo
echo "start the dev server with:"
echo "  cd web && CANVAS_DEV_HTTPS=1 bun run dev"
echo
echo "浏览器首次访问会提示证书不受信任，选择“继续访问”即可；"
echo "若不希望每次都提示，可把 $cert_file 导入系统或浏览器信任库。"
