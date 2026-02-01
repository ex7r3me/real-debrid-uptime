#!/usr/bin/env bash
# One-time setup for Real-Debrid Uptime Monitor on a Hetzner (or any Debian/Ubuntu) server.
# Run from the repo root (or from anywhere: scripts/setup-hetzner.sh).
# Requires: sudo (for install, systemd, sudoers).

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- config (override with env or leave defaults) ---
APP_USER="${APP_USER:-$USER}"
PORT="${PORT:-3000}"
SERVICE_NAME="real-debrid-uptime"

echo "=== Real-Debrid Uptime – Hetzner setup ==="
echo "Repo root: $REPO_ROOT"
echo "App user:  $APP_USER"
echo "Port:      $PORT"
echo ""

# --- 1. Node.js 20 (Debian/Ubuntu) ---
if ! command -v node &>/dev/null; then
  echo ">>> Installing Node.js 20..."
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    if [[ "$ID" == "debian" || "$ID" == "ubuntu" ]]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs
    else
      echo "Unsupported OS: $ID. Install Node 18+ manually and re-run."
      exit 1
    fi
  else
    echo "Cannot detect OS. Install Node 18+ and re-run."
    exit 1
  fi
else
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VER" -lt 18 ]]; then
    echo "Node $NODE_VER found; need 18+. Install Node 20 and re-run."
    exit 1
  fi
  echo ">>> Node.js $(node -v) already installed."
fi

# --- 2. Git ---
if ! command -v git &>/dev/null; then
  echo ">>> Installing git..."
  sudo apt-get update && sudo apt-get install -y git
else
  echo ">>> Git already installed."
fi

# --- 3. Dependencies and build ---
echo ">>> Installing dependencies and building..."
npm ci
(cd frontend && npm ci)
npm run build:all

# --- 4. .env ---
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ">>> Created .env from .env.example."
  read -p "Enter your Real-Debrid API key (or press Enter to edit .env later): " RD_KEY
  if [[ -n "$RD_KEY" ]]; then
    if grep -q '^REAL_DEBRID_API_KEY=' .env; then
      sed -i "s|^REAL_DEBRID_API_KEY=.*|REAL_DEBRID_API_KEY=$RD_KEY|" .env
    else
      echo "REAL_DEBRID_API_KEY=$RD_KEY" >> .env
    fi
    echo ">>> API key written to .env."
  else
    echo ">>> Edit .env and set REAL_DEBRID_API_KEY, then start the service."
  fi
else
  echo ">>> .env already exists; skipping."
fi

# --- 5. systemd service ---
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_PATH="$(command -v node)"

echo ">>> Installing systemd service..."
sudo tee "$UNIT_FILE" >/dev/null <<EOF
[Unit]
Description=Real-Debrid Uptime Monitor
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$REPO_ROOT
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$NODE_PATH dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"
echo ">>> Service $SERVICE_NAME enabled and started."

# --- 6. Sudoers: allow $APP_USER to restart the service without password ---
SUDOERS_LINE="$APP_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart $SERVICE_NAME"
if ! sudo grep -qF "$SUDOERS_LINE" /etc/sudoers 2>/dev/null; then
  echo "$SUDOERS_LINE" | sudo tee -a /etc/sudoers.d/"$SERVICE_NAME" >/dev/null
  sudo chmod 440 /etc/sudoers.d/"$SERVICE_NAME"
  echo ">>> Sudoers rule added so $APP_USER can run: sudo systemctl restart $SERVICE_NAME"
else
  echo ">>> Sudoers rule already present."
fi

# --- 7. Status ---
sleep 1
sudo systemctl status "$SERVICE_NAME" --no-pager || true

echo ""
echo "=== Setup done ==="
echo "  App:     http://localhost:$PORT"
echo "  Logs:    sudo journalctl -u $SERVICE_NAME -f"
echo "  Restart: sudo systemctl restart $SERVICE_NAME"
echo ""
echo "=== For GitHub Actions CD (optional) ==="
echo "  1. Add this server's deploy path to GitHub Secrets:"
echo "     HETZNER_DEPLOY_PATH=$REPO_ROOT"
echo "  2. In GitHub repo: Settings → Secrets → Actions, add:"
echo "     HETZNER_HOST, HETZNER_USER, HETZNER_SSH_KEY"
echo "  3. On this server, add the deploy key to $APP_USER's authorized_keys:"
echo "     echo 'PASTE_PUBLIC_KEY' >> ~/.ssh/authorized_keys"
echo ""
