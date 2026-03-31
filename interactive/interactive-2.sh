#!/bin/bash

set -euo pipefail

read -rp "Provide a number to square: " raw_value
while [[ ! $raw_value =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; do
  read -rp "Please enter a numeric value: " raw_value
done

result=$(awk "BEGIN { print ($raw_value)^2 }")
echo "You entered $raw_value and its square is $result."
