#!/bin/bash

set -euo pipefail

read -rp "Enter your name (or leave blank for Guest): " name
name=${name:-Guest}
echo "Welcome, $name! This is the simplest interactive script."
