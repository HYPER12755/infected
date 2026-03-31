#!/bin/bash

set -euo pipefail

services=(database cache search api)

echo "Select a service to inspect."
PS3="Enter the number of the service (or 0 to quit): "
select service in "${services[@]}"; do
  if [[ -z $service ]]; then
    if [[ $REPLY -eq 0 ]]; then
      echo "Exiting."
      exit 0
    fi
    echo "Invalid selection; try again."
    continue
  fi

  read -rp "What status keyword should we look for (e.g., ok/warn): " keyword
  case "${keyword,,}" in
    ok) echo "Service $service reports green, all metrics nominal."; break ;;
    warn) echo "Service $service has warnings; check logs."; break ;;
    *) echo "No special keywords matched for $service ($keyword)."; break ;;
  esac
done
