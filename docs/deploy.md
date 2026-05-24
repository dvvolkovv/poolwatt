# Poolwatt deploy — `dv@77.221.159.163`

## Server provisioning (one-time, manual)

Performed by the human operator from the laptop, because the agent's auto-mode
classifier refuses to write provisioning expect-scripts that authenticate to a
non-trusted host with credentials read from a temp file.

```bash
# 1) From the laptop, with the root password in hand:
ssh root@77.221.159.163 'bash -s' <<'PROVISION'
set -euo pipefail
NEW_USER=dv
PUBKEY='ssh-ed25519 AAAA...  dv@poolwatt'   # <-- replace with your real pubkey

if ! id -u "$NEW_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$NEW_USER"
fi

echo "dv ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$NEW_USER
chmod 0440 /etc/sudoers.d/$NEW_USER
visudo -cf /etc/sudoers.d/$NEW_USER

install -d -m 0700 -o "$NEW_USER" -g "$NEW_USER" /home/$NEW_USER/.ssh
echo "$PUBKEY" > /home/$NEW_USER/.ssh/authorized_keys
chmod 0600 /home/$NEW_USER/.ssh/authorized_keys
chown "$NEW_USER":"$NEW_USER" /home/$NEW_USER/.ssh/authorized_keys
PROVISION

# 2) Verify
ssh -i ~/.ssh/id_ed25519_poolwatt dv@77.221.159.163 'sudo whoami'   # should print: root

# 3) Lock down root logins (recommended)
ssh -i ~/.ssh/id_ed25519_poolwatt dv@77.221.159.163 \
  "sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && sudo systemctl restart ssh"
```

## Software bootstrap (one-time)

```bash
ssh dv@77.221.159.163 'bash -s' <<'SETUP'
set -euo pipefail
sudo apt-get update
sudo apt-get install -y curl git nginx postgresql redis-server build-essential

# Node.js 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo npm install -g pm2

# Postgres role + db
sudo -u postgres createuser --pwprompt poolwatt || true
sudo -u postgres createdb --owner=poolwatt poolwatt || true

# Clone
cd ~ && [ -d poolwatt ] || git clone https://github.com/<your-fork>/poolwatt.git
cd poolwatt
cp -n .env.example .env.local || true
echo "Now edit ~/poolwatt/.env.local with real credentials, then run npm ci && npm run build"
SETUP
```

## Day-to-day deploy

```bash
# Local: push to main
git push origin main

# Server: pull, install deps, build, restart
ssh dv@77.221.159.163 <<'DEPLOY'
set -euo pipefail
cd ~/poolwatt
git pull --ff-only
npm ci
npm run build
pm2 restart poolwatt-web poolwatt-worker poolwatt-bot
pm2 save
DEPLOY
```

### Worker stale-lib gotcha

Any change under `src/lib/*` that the worker imports requires a worker restart
as well — `tsx` pins lib source at boot, so a web-only restart leaves the
worker executing stale code (it will keep overwriting Redis snapshots with
old-shaped data). When in doubt, restart all three:

```bash
pm2 restart poolwatt-web poolwatt-worker poolwatt-bot
```

## Health checks

```bash
curl https://poolwatt.com/api/health      # 200 OK + JSON
pm2 status                                  # all three: online
ssh dv@77.221.159.163 sudo journalctl -u nginx --since "5 min ago" | tail
```

## Backups

Postgres backups run daily at 03:00 UTC via cron, stored at `~/backups/pg/`
with 14-day retention. Configured in Phase 2.
