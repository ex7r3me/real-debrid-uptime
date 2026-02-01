# Deploy to Hetzner (CI/CD)

This project uses **GitHub Actions** for CI (lint + build on every push/PR) and **CD** (deploy to a Hetzner server on every push to `main`).

## 1. One-time setup on the Hetzner server

### Option A: Automated script (easiest)

SSH into your server **as root or a sudo user**, clone the repo, then run the setup script.

**With a dedicated deploy user (recommended):**

```bash
git clone https://github.com/ex7r3me/real-debrid-uptime.git /var/www/real-debrid-uptime
cd /var/www/real-debrid-uptime
CREATE_DEPLOY_USER=1 ./scripts/setup-hetzner.sh
```

This creates a system user `deploy`, gives it ownership of the app directory, and runs the app under that user. GitHub Actions will SSH as `deploy` and run deploys.

**Without a dedicated user (use your current user):**

```bash
git clone https://github.com/ex7r3me/real-debrid-uptime.git /var/www/real-debrid-uptime
cd /var/www/real-debrid-uptime
./scripts/setup-hetzner.sh
```

The script will:

- **(If `CREATE_DEPLOY_USER=1`)** Create user `deploy` (or `DEPLOY_USER`), set up `~/.ssh` for that user, and chown the repo to it
- Install Node.js 20 and git (Debian/Ubuntu)
- Run `npm ci` and `npm run build:all`
- Create `.env` from `.env.example` and prompt for your Real-Debrid API key
- Install and start a systemd service (`real-debrid-uptime`)
- Add a sudoers rule so the deploy user can run `sudo systemctl restart real-debrid-uptime` without a password (for GitHub Actions CD)

Override defaults with env vars (optional):

```bash
DEPLOY_USER=app CREATE_DEPLOY_USER=1 ./scripts/setup-hetzner.sh
APP_USER=myuser PORT=3000 ./scripts/setup-hetzner.sh   # no dedicated user
```

Then set up **key management** (below) and [GitHub secrets](#2-github-repository-configuration).

---

### User and key management

**1. Deploy user**

- **Recommended:** Use `CREATE_DEPLOY_USER=1` so the app and deploys run as a dedicated user (e.g. `deploy`). No shared login; GitHub Actions uses only this user’s SSH key.
- **Optional:** Use your own SSH user and set `HETZNER_USER` to that; ensure that user can `sudo systemctl restart real-debrid-uptime` (the setup script adds the sudoers rule for `APP_USER`).

**2. Generate a deploy key (on your machine)**

Run from the repo root:

```bash
./scripts/setup-deploy-key.sh
```

This creates an Ed25519 key pair in **`~/.ssh/hetzner_deploy_real_debrid_uptime`** (outside the repo, so it can’t be committed by mistake). To use a different path: `./scripts/setup-deploy-key.sh /path/to/key`. The script prints:

- The exact line to add the **public** key on the server (for the deploy user’s `~/.ssh/authorized_keys`)
- How to add the **private** key as the GitHub secret `HETZNER_SSH_KEY`

**3. Add the public key on the server**

On the Hetzner server, as the user that will run deploys (e.g. `deploy`):

```bash
# If using dedicated user (e.g. deploy):
sudo -u deploy bash -c 'echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys'

# If using your own user:
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
```

**4. Add the private key in GitHub**

- Repo → **Settings** → **Secrets and variables** → **Actions**
- **New repository secret** → Name: `HETZNER_SSH_KEY`, Value: entire contents of `hetzner_deploy_key` (the private key file)
- Never commit the private key; you can delete it from your machine after adding it to GitHub if you prefer.

**5. GitHub secrets to set**

| Secret | Description |
|--------|-------------|
| `HETZNER_HOST` | Server hostname or IP |
| `HETZNER_USER` | SSH user (e.g. `deploy` if you used `CREATE_DEPLOY_USER=1`) |
| `HETZNER_SSH_KEY` | Full body of the **private** deploy key |
| `HETZNER_DEPLOY_PATH` | (Optional) App path on server, e.g. `/var/www/real-debrid-uptime` |

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

### Allow GitHub Actions to run deploy commands (manual setup)

The workflow will SSH in, `git pull`, build, and restart the service. The user that GitHub uses must be able to `cd` into the repo, run `npm ci` and `npm run build:all`, and run `sudo systemctl restart real-debrid-uptime` without a password. The automated script adds the sudoers rule for you; if you set up manually, add:

```bash
sudo visudo
# Add (replace deploy with your SSH user):
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart real-debrid-uptime
```

## 2. GitHub repository configuration

The required secrets are listed in [User and key management](#user-and-key-management) above. Add them under **Settings → Secrets and variables → Actions**.

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
