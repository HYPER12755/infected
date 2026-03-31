#!/bin/bash

set -euo pipefail

default_config="config.json"
read -rp "Config file path (enter to use ${default_config}): " config_path
config_path=${config_path:-$default_config}

if [[ ! -f $config_path ]]; then
  echo "File $config_path not found. Create placeholder with default stages? [y/N]"
  read -rn1 create && echo
  if [[ $create =~ ^[Yy]$ ]]; then
    cat <<EOF > "$config_path"
{
  "stages": ["alpha", "beta", "gamma"]
}
EOF
    echo "Created $config_path."
  else
    echo "Aborting without config."
    exit 1
  fi
fi

read -rp "Stage to highlight: " stage
stage=${stage:-beta}

stage_list=$(jq -r '.stages[]' "$config_path")
for candidate in $stage_list; do
  if [[ $candidate == "$stage" ]]; then
    echo "Stage '$stage' exists; ready to run."
    exit 0
  fi
done
echo "Stage '$stage' is not listed in $config_path. Available: $stage_list"
