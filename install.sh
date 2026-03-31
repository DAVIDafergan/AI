#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
#  GhostLayer V4.0 – White-Glove Installation Script
#  Managed by DA Projects & Entrepreneurship
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
RED="\033[0;31m"
RESET="\033[0m"

print_banner() {
  echo -e "${CYAN}"
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║          GhostLayer V4.0 – Enterprise Installation       ║"
  echo "║           DA Projects & Entrepreneurship                 ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo -e "${RESET}"
}

check_command() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    echo -e "${RED}✗ '$cmd' is not installed. Please install it and re-run this script.${RESET}"
    exit 1
  fi
  echo -e "${GREEN}✓ $cmd found${RESET}"
}

# ── Pre-flight checks ────────────────────────────────────────────────────────
print_banner
echo -e "${BOLD}Verifying system requirements...${RESET}"
check_command docker
check_command docker-compose

# ── Ensure environment file is present ──────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo -e "${RED}✗ .env file not found at $ENV_FILE${RESET}"
  echo "  Please create it with MONGODB_URI and SUPER_ADMIN_KEY before running this script."
  exit 1
fi

echo -e "${GREEN}✓ .env file found${RESET}"

# ── Pull images and start services ──────────────────────────────────────────
echo ""
echo -e "${BOLD}Pulling Docker images...${RESET}"
docker-compose -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" pull

echo ""
echo -e "${BOLD}Building and starting GhostLayer services...${RESET}"
docker-compose -f "$SCRIPT_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --build

# ── Success message (Hebrew, Right-to-Left) ──────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
printf '╔══════════════════════════════════════════════════════════╗\n'
printf '║                                                          ║\n'
printf '║   ✅  המערכת פועלת ומאובטחת ברשת המקומית!              ║\n'
printf '║                                                          ║\n'
printf '║   GhostLayer V4.0 הותקן בהצלחה.                        ║\n'
printf '║   הפורטל זמין בכתובת: http://localhost:3000             ║\n'
printf '║                                                          ║\n'
printf '╚══════════════════════════════════════════════════════════╝\n'
echo -e "${RESET}"
