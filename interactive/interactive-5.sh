#!/bin/bash

set -euo pipefail

declare -A checklist
echo "Interactive checklist builder. Leave name blank to stop."

while :; do
  read -rp "Task name: " task
  [[ -z $task ]] && break

  read -rp "Priority (low/med/high): " priority
  priority=${priority,,}
  case $priority in
    low|med|high) ;;
    *) priority=low ;;
  esac

  read -rp "Should this task trigger a reminder? (y/N): " remind
  reminder="no"
  if [[ $remind =~ ^[Yy]$ ]]; then
    read -rp "Reminder in minutes: " minutes
    reminder="yes in ${minutes}m"
  fi

  checklist["$task"]="priority=$priority, remind=${reminder}"
  echo "Recorded: $task (${checklist[$task]})"
done

if [[ ${#checklist[@]} -eq 0 ]]; then
  echo "No tasks captured."
  exit 0
fi

echo "Summary:"
for task in "${!checklist[@]}"; do
  printf '  - %s (%s)\n' "$task" "${checklist[$task]}"
done
