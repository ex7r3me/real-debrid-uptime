# Deploy to Hetzner (CI/CD)

This project uses **GitHub Actions** for CI (lint + build on every push/PR) and **CD** (deploy to a Hetzner server on every push to `main`).

## 1. One-time setup on the Hetzner server

### Option A: Automated script (easiest)

SSH into your server, clone the repo, then run the setup script:

```bash
git clone https://github.com/ex7r3me/real-debrid-uptime.git /var/www/real-debrid-uptime
cd /var/www/real-debrid-uptime
./scripts/setup-hetzner.sh
```

The script will:

- Install Node.js 20 and git (Debian/Ubuntu)
- Run `npm ci` and `npm run build:all`
- Create `.env` from `.env.example` and prompt for your Real-Debrid API key
- Install and start a systemd service (`real-debrid-uptime`)
- Add a sudoers rule so the deploy user can run `sudo systemctl restart real-debrid-uptime` without a password (for GitHub Actions CD)

Override defaults with env vars (optional):

```bash
APP_USER=app PORT=3000 ./scripts/setup-hetzner.sh
```

Then add your GitHub Actions SSH public key to `~/.ssh/authorized_keys` for the user that will deploy (same as `APP_USER` if you set it), and configure [GitHub secrets](#2-github-repository-configuration) below.

### Option B: Manual steps

SSH into your server and do the following.

### Install Node.js 20 (LTS)

```bash
# Example for Ubuntu/Debian (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Create app user and directory (optional but recommended)

```bash
sudo useradd -m -s /bin/bash app
sudo su - app
```

### Clone the repo

```bash
# As your deploy user (e.g. app or your own user)
git clone https://github.com/ex7r3me/real-debrid-uptime.git /var/www/real-debrid-uptime
cd /var/www/real-debrid-uptime
```

(Use your actual GitHub repo URL and path. This path is the **deploy path** you’ll use in GitHub secrets.)

### Install dependencies and build

```bash
npm ci
cd frontend && npm ci && cd ..
npm run build:all
```

### Create `.env` and `streams.json`

```bash
cp .env.example .env
# Edit .env and set REAL_DEBRID_API_KEY, PORT, etc.
# Edit streams.json if needed.
```

Do **not** commit `.env`; it stays only on the server.

### Create a systemd service

```bash
sudo nano /etc/systemd/system/real-debrid-uptime.service
```

Use (adjust `User`, `WorkingDirectory`, and `PORT` if needed):

```ini
[Unit]
Description=Real-Debrid Uptime Monitor
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=/var/www/real-debrid-uptime
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable real-debrid-uptime
sudo systemctl start real-debrid-uptime
sudo systemctl status real-debrid-uptime
```

### Allow GitHub Actions to run deploy commands

The workflow will SSH in, `git pull`, build, and restart the service. The user that GitHub uses must:

1. Be able to `cd` into the repo and run `git fetch` / `git reset --hard`.
2. Be able to run `npm ci` and `npm run build:all` in that directory.
3. Be able to run `sudo systemctl restart real-debrid-uptime` without a password.

Option A – use your own user and give it passwordless sudo for that one command:

```bash
sudo visudo
# Add (replace deploy with your SSH user):
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart real-debrid-uptime
```

Option B – run the app as the same user that SSH deploys (e.g. `deploy`). Then that user owns the repo and runs the app; you only need the sudo rule above for `systemctl restart`.

### SSH key for GitHub Actions

On your **local machine** (or server), generate a key used only for deploys:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f hetzner_deploy_key -N ""
```

- Add the **public** key to the server:

  ```bash
  # Copy hetzner_deploy_key.pub to server, then on server:
  mkdir -p ~/.ssh
  cat >> ~/.ssh/authorized_keys << 'EOF'
  <paste contents of hetzner_deploy_key.pub>
  EOF
  chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
  ```

- Add the **private** key to GitHub (see below). Never commit it.

## 2. GitHub repository configuration

### Required secrets

In the repo: **Settings → Secrets and variables → Actions**, add:

| Secret                | Description |
|-----------------------|-------------|
| `HETZNER_HOST`        | Server hostname or IP (e.g. `123.45.67.89` or `monitor.example.com`). |
| `HETZNER_USER`        | SSH user (e.g. `deploy` or `app`). |
| `HETZNER_SSH_KEY`     | Full contents of the **private** key file (e.g. `hetzner_deploy_key`). |
| `HETZNER_DEPLOY_PATH` | (Optional) Path to the repo on the server. Default: `/var/www/real-debrid-uptime`. |

### Optional: use an environment

To add approval or restrict who can deploy:

1. **Settings → Environments** → create an environment, e.g. `production`.
2. The workflow already uses `environment: production` for the deploy job, so deploys will use this environment (and any protection rules you set).

## 3. What runs when

- **Every push and every PR targeting `main`**  
  - **CI**: Lint (backend `tsc --noEmit` + frontend ESLint) and full build (backend + frontend).  
  - No deploy.

- **Every push to `main`** (after CI passes)  
  - **CD**: SSH to Hetzner → `git fetch` / `git reset --hard origin/main` → `npm ci` → `npm run build:all` → `sudo systemctl restart real-debrid-uptime`.

- **Manual run**  
  - **Actions → CI/CD → Run workflow** runs both CI and (on `main`) CD.

## 4. Troubleshooting

- **“Permission denied (publickey)”**  
  Check `HETZNER_HOST`, `HETZNER_USER`, and that the public key is in `~/.ssh/authorized_keys` for that user.

- **“npm: command not found”**  
  Install Node (see above) and ensure the SSH user’s `PATH` includes it (e.g. login shell or set in the service).

- **“sudo: no tty present”**  
  Use `NOPASSWD` for the single `systemctl restart` command (see above).

- **App not updating**  
  On the server run `git status` and `git log -1` in the deploy path; confirm the deploy user can pull and that the systemd service `WorkingDirectory` matches that path.
