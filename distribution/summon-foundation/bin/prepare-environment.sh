#!/bin/sh
# C6: bootstrap the npm entry, not Foundation itself. No Node/npm is needed
# to inspect this plan. Keep pins aligned with official-node-runtime.mjs.
set -eu
umask 077
fail(){ printf '错误：%s\n' "$1" >&2; exit 1; }
version=24.14.1
archive_hash=25495ff85bd89e2d8a24d88566d7e2f827c6b0d3d872b2cebf75371f93fcb1fe
node_hash=35d4bc736bbe4161f0c074aa140ddb74586e46969bc2ad63d32c838bec4463ff
license_hash=4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18
url=https://nodejs.org/dist/v24.14.1/node-v24.14.1-darwin-arm64.tar.gz
prefix=node-v24.14.1-darwin-arm64
mode=${1:-}; destination=${2:-}; approval=${3:-}
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || fail '用法：sh prepare-environment.sh --inspect /绝对独立目录；本人批准后以 --prepare 同一路径 精确计划摘要执行'
case "$mode" in --inspect|--prepare) ;; *) fail '仅支持查看计划或按批准准备环境' ;; esac
case "$destination" in /*) ;; *) fail '环境位置必须是绝对路径' ;; esac
case "$destination" in *'
'*|*'/../'*|*'/./'*|*/|'/') fail '环境位置必须是规范化独立目录' ;; esac
[ "$(/usr/bin/uname -s)" = Darwin ] && [ "$(/usr/bin/uname -m)" = arm64 ] || fail '此设备暂不支持；不会通过准备环境绕过平台限制'
for tool in /usr/bin/curl /usr/bin/tar /usr/bin/shasum /usr/bin/stat /bin/mkdir /bin/chmod; do [ -x "$tool" ] || fail "缺少可信系统工具：$tool"; done
parent=${destination%/*}; [ -n "$parent" ] || fail '不能写系统根目录'
[ -d "$parent" ] && [ -w "$parent" ] && [ -x "$parent" ] || fail '父目录不存在或无权限；不会代建系统目录'
[ "$(CDPATH= cd -- "$parent" && pwd -P)" = "$parent" ] || fail '父目录含链接或非规范路径'
cursor=$parent
while [ "$cursor" != / ]; do [ ! -L "$cursor" ] || fail '拒绝符号链接祖先'; cursor=${cursor%/*}; [ -n "$cursor" ] || cursor=/; done
[ ! -e "$destination" ] && [ ! -L "$destination" ] || fail '目标已经存在；保留已有或失败材料，请核验后选择新的独立目录'
parent_identity=$(/usr/bin/stat -f '%d:%i:%u:%Lp' "$parent")
plan=$(printf 'foundation-entry-environment-v1\n%s\n%s\n%s\n%s\n%s\nno-shared-settings\n' "$version" "$destination" "$parent_identity" "$url" "$archive_hash" | /usr/bin/shasum -a 256)
plan=${plan%% *}
printf '基础环境计划：Node.js %s（含 npm），仅用于启动获取器\n来源：%s\n位置：%s\n影响：不修改现有 Node、Shell、PATH 或系统设置；不安装 Foundation、不注册 Skill\n保留：失败材料和环境回执；不自动清理\n计划摘要：%s\n' "$version" "$url" "$destination" "$plan"
[ "$mode" = --prepare ] || exit 0
[ -n "$approval" ] && [ "$approval" = "$plan" ] || fail '缺少匹配的本人批准计划摘要；没有准备环境'
# The invoking Codex task must obtain human approval for the displayed plan.
# This argument binds that request; it is not evidence of a UI confirmation.
[ "$(CDPATH= cd -- "$parent" && pwd -P)" = "$parent" ] && [ "$(/usr/bin/stat -f '%d:%i:%u:%Lp' "$parent")" = "$parent_identity" ] || fail '父目录在批准后变化；没有准备环境'
/bin/mkdir -m 700 -- "$destination" || fail '创建独占环境目录失败'
printf 'state=preparing\nplan=%s\nsource=%s\narchive_sha256=%s\nshared_settings_changed=false\n' "$plan" "$url" "$archive_hash" > "$destination/environment-result.txt"
trap 'printf "state=failed-or-interrupted\n" >> "$destination/environment-result.txt"' EXIT
/usr/bin/curl -q --fail --silent --show-error --location --max-redirs 3 --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 600 --max-filesize 134217728 -o "$destination/node.tar.gz" "$url" || fail '官方环境下载失败；保留材料，不执行'
observed=$(/usr/bin/shasum -a 256 "$destination/node.tar.gz"); [ "${observed%% *}" = "$archive_hash" ] || fail '官方环境归档摘要不匹配'
/usr/bin/tar -xzpf "$destination/node.tar.gz" --no-same-owner --no-acls --no-fflags --no-mac-metadata --no-xattrs -C "$destination" || fail '已验证归档解包失败'
node="$destination/$prefix/bin/node"
[ -f "$node" ] && [ ! -L "$node" ] && [ -x "$node" ] || fail '缺少绑定运行时'
observed=$(/usr/bin/shasum -a 256 "$node"); [ "${observed%% *}" = "$node_hash" ] || fail '运行时字节不符'
observed=$(/usr/bin/shasum -a 256 "$destination/$prefix/LICENSE"); [ "${observed%% *}" = "$license_hash" ] || fail '许可字节不符'
unset NODE_OPTIONS NODE_PATH NODE_V8_COVERAGE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE NODE_COMPILE_CACHE_PORTABLE NODE_PRESERVE_SYMLINKS
[ "$("$node" --version)" = "v$version" ] || fail '环境准备后版本复检失败'
[ -f "$destination/$prefix/lib/node_modules/npm/bin/npm-cli.js" ] || fail '官方环境缺少 npm 入口'
printf 'state=prepared-and-rechecked\nnode_version=%s\nnode_sha256=%s\nnode=%s\nnpm_cli=%s\n' "$version" "$node_hash" "$node" "$destination/$prefix/lib/node_modules/npm/bin/npm-cli.js" >> "$destination/environment-result.txt"
trap - EXIT
printf '基础环境已准备并复检。由当前任务以此 Node 和 npm 入口启动已固定版本的 Foundation 单页；不要更改全局 PATH。\n回执：%s/environment-result.txt\n' "$destination"
