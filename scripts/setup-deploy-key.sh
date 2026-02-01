#!/usr/bin/env bash
# Generate an SSH key pair for GitHub Actions → Hetzner deploy.
# Run on your local machine (not on the server). Never commit the private key.
#
# Usage: ./scripts/setup-deploy-key.sh [output_key_path]
# Default: ~/.ssh/hetzner_deploy_real_debrid_uptime (outside the repo, safe from accidental commit)

set -e

DEFAULT_KEY="$HOME/.ssh/hetzner_deploy_real_debrid_uptime"
KEY_PATH="${1:-$DEFAULT_KEY}"
KEY_PATH="${KEY_PATH/#\~/$HOME}"
KEY_DIR="$(cd "$(dirname "$KEY_PATH")" && pwd)"
KEY_NAME="$(basename "$KEY_PATH")"
KEY_FILE="$KEY_DIR/$KEY_NAME"

if [[ -f "$KEY_FILE" ]]; then
  echo "Key already exists: $KEY_FILE"
  echo "Use a different path or remove it first."
  exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR" 2>/dev/null || true

echo ">>> Generating deploy key: $KEY_FILE"
ssh-keygen -t ed25519 -C "github-actions-deploy-real-debrid-uptime" -f "$KEY_FILE" -N ""

echo ""
echo "=== Deploy key created ==="
echo ""
echo "1. Add the PUBLIC key to your Hetzner server (deploy user):"
echo "   Run on server (replace DEPLOY_USER and paste the key):"
echo ""
echo "   sudo -u DEPLOY_USER bash -c \"echo '$(cat "${KEY_FILE}.pub")' >> ~/.ssh/authorized_keys\""
echo ""
echo "   Or paste this into the server (as the deploy user):"
echo "   ---"
cat "${KEY_FILE}.pub"
echo "   ---"
echo ""
echo "2. Add the PRIVATE key to GitHub:"
echo "   Repo → Settings → Secrets and variables → Actions → New repository secret"
echo "   Name:  HETZNER_SSH_KEY"
echo "   Value: (paste the entire contents of $KEY_FILE)"
echo ""
echo "   To copy private key to clipboard (macOS):"
echo "   cat $KEY_FILE | pbcopy"
echo ""
echo "3. Set GitHub secrets: HETZNER_HOST, HETZNER_USER (deploy user), HETZNER_DEPLOY_PATH (optional)."
echo ""
if [[ "$KEY_FILE" == "$HOME/.ssh/"* ]]; then
  echo ">>> Key is in ~/.ssh (outside the repo) — safe from accidental commit."
else
  echo ">>> Keep $KEY_FILE private and do not commit it."
fi
