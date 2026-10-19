#!/usr/bin/env bash
# Selected non-secret facts only; never dump inspect/config environments.
set -euo pipefail
printf 'run=%s attempt=%s job=%s sha=%s runner=%s\n' \
  "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$GITHUB_JOB" "$GITHUB_SHA" "$RUNNER_NAME"
runner_kernel=$(uname -r)
printf 'runner_arch=%s runner_kernel=%s\n' "$(uname -m)" "$runner_kernel"
docker info --format 'daemon={{.Architecture}} cpus={{.NCPU}} memory={{.MemTotal}} kernel={{.KernelVersion}} os={{.OperatingSystem}}'
kernel=$(docker info --format '{{.KernelVersion}}')
# The socket must belong to the executing container's daemon, not another host.
[[ "$RUNNER_NAME" =~ ^ciw-[a-zA-Z0-9_.-]+-runner-[a-zA-Z0-9_.-]+$ ]] || exit 1
docker ps --format '{{.Names}}' | grep -Fx -- "$RUNNER_NAME" >/dev/null
container=$(docker inspect --format '{{.Name}}|{{.Config.Hostname}}|{{.Id}}|{{.Platform}}|{{.Image}}' "$RUNNER_NAME")
IFS='|' read -r name hostname id platform image <<< "$container"
[[ "$name" = "/$RUNNER_NAME" && -n "$hostname" && -n "$id" && -n "$image" && "$platform" = linux ]] || exit 1
[[ "$(uname -n)" = "$hostname" ]] || exit 1
[[ -n "$kernel" && "$kernel" != unknown && -n "$runner_kernel" && "$runner_kernel" != unknown ]] || exit 1
[[ "$kernel" = "$runner_kernel" ]] || exit 1
printf 'container=%s\n' "$container"
case "$kernel" in
  *microsoft-standard-WSL2*) echo 'host_backend=windows-wsl2';;
  *) echo 'host_backend=windows-not-proven';;
esac
