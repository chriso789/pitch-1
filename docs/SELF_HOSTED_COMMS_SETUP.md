# Self-Hosted Communications Stack - Phase 1 Setup Guide

## Overview
This guide walks you through setting up the self-hosted communications infrastructure (Asterisk PBX, Coturn, SMPP, SMTP) to run alongside your existing Telnyx/Twilio setup.

## Prerequisites

### Required Infrastructure
- [ ] **VPS/Cloud Server** with:
  - Ubuntu 22.04 LTS or Debian 12
  - Minimum 4GB RAM, 2 vCPUs
  - 50GB disk space
  - **Public static IP address** (no CGNAT)
  - Root/sudo access

- [ ] **Domain Name** (e.g., `yourdomain.com`) with ability to:
  - Add A records for `pbx.yourdomain.com`
  - Add A records for `turn.yourdomain.com`
  - Add MX records for email inbound

- [ ] **Docker & Docker Compose** installed on server

### Required Services/Accounts
- [ ] **SIP Trunk Provider** (choose one):
  - Bandwidth.com (best quality, USA/Canada)
  - Telnyx SIP (global, cheaper)
  - Twilio Elastic SIP Trunking
  
- [ ] **SMPP Provider** (choose one):
  - Bandwidth SMS (if using Bandwidth for voice)
  - SMPP.com
  - OR: GSM modem for testing (not recommended for production)

- [ ] **TLS Certificates**:
  - Let's Encrypt (recommended, free)
  - OR: Commercial SSL provider

---

## Phase 1: Infrastructure Setup Steps

### Step 1: Provision VPS

**Recommended Providers:**
- DigitalOcean: Droplet ($24/mo for 4GB)
- Linode: Shared 4GB ($24/mo)
- Vultr: Cloud Compute 4GB ($24/mo)
- AWS EC2: t3.medium (~$30/mo)

**Server Requirements:**
```bash
OS: Ubuntu 22.04 LTS
RAM: 4GB minimum
CPU: 2 vCPUs minimum
Storage: 50GB SSD
Network: Public IPv4 (static)
```

### Step 2: Configure DNS

Add these DNS records (replace with your actual public IP):

```
Type    Name                Value               TTL
A       pbx.yourdomain.com  YOUR_PUBLIC_IP      300
A       turn.yourdomain.com YOUR_PUBLIC_IP      300
A       comms.yourdomain.com YOUR_PUBLIC_IP     300
MX      @                   comms.yourdomain.com 10
```

Wait 5-10 minutes for DNS propagation, verify with:
```bash
dig pbx.yourdomain.com +short
# Should return YOUR_PUBLIC_IP
```

### Step 3: Install Docker & Docker Compose

SSH into your server and run:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify installations
docker --version
docker compose version

# Logout and login again for group permissions
exit
# SSH back in
```

### Step 4: Deploy the Communications Stack

```bash
# Download and extract lovable-comm.zip (transfer from your local machine)
scp docs/lovable-comm.zip user@YOUR_SERVER_IP:/home/user/
ssh user@YOUR_SERVER_IP

# On the server:
unzip lovable-comm.zip
cd lovable-comm

# Copy environment template
cp .env.example .env
```

### Step 5: Configure Environment Variables

Edit `.env` file with your actual values:

```bash
nano .env
```

**Required Configuration:**

```bash
# === Network Configuration ===
PUBLIC_IP=YOUR_PUBLIC_IP          # e.g., 203.0.113.45
PBX_FQDN=pbx.yourdomain.com       # Your Asterisk domain
COMMS_API_FQDN=comms.yourdomain.com

# === Asterisk WebRTC ===
WEBRTC_EXT=1001                   # First extension number
WEBRTC_PASSWORD=SecurePass123!    # Generate strong password
ASTERISK_ARI_USER=ariuser
ASTERISK_ARI_PASSWORD=AriPass456! # Generate strong password

# === SIP Trunk (get from your provider) ===
SIP_TRUNK_SERVER=sip.bandwidth.com  # or sip.telnyx.com, etc.
SIP_TRUNK_USERNAME=your_trunk_username
SIP_TRUNK_PASSWORD=your_trunk_password
SIP_TRUNK_DID=+15551234567        # Your inbound phone number

# === Coturn (TURN/STUN for WebRTC) ===
TURN_USERNAME=turnuser            # Choose a username
TURN_PASSWORD=TurnSecret789!      # Generate strong password
TURN_REALM=turn.yourdomain.com

# === SMPP (SMS) ===
SMPP_URL=smpp://smpp.provider.com:2775
SMPP_SYSTEM_ID=your_system_id     # From SMPP provider
SMPP_PASSWORD=your_smpp_password  # From SMPP provider
SMPP_SOURCE_NUMBER=+15551234567   # Your SMS sender number

# === SMTP (Email) ===
SMTP_RELAY_HOST=smtp.sendgrid.net # Keep using SendGrid for outbound
SMTP_RELAY_PORT=587
SMTP_RELAY_USER=apikey
SMTP_RELAY_PASSWORD=your_sendgrid_api_key

# === Database ===
POSTGRES_PASSWORD=DbPassword321!  # Generate strong password
POSTGRES_DB=comms_db
POSTGRES_USER=comms_user

# === Redis ===
REDIS_PASSWORD=RedisPass654!      # Generate strong password
```

Save the file (Ctrl+X, Y, Enter in nano).

### Step 6: Generate TLS Certificates

**Option A: Let's Encrypt (Recommended)**

```bash
# Install certbot
sudo apt install certbot -y

# Generate certificates for PBX
sudo certbot certonly --standalone -d pbx.yourdomain.com \
  --non-interactive --agree-tos --email your@email.com

# Generate certificates for Coturn
sudo certbot certonly --standalone -d turn.yourdomain.com \
  --non-interactive --agree-tos --email your@email.com

# Copy certificates to the project
sudo cp /etc/letsencrypt/live/pbx.yourdomain.com/fullchain.pem \
  services/asterisk/keys/fullchain.pem
sudo cp /etc/letsencrypt/live/pbx.yourdomain.com/privkey.pem \
  services/asterisk/keys/privkey.pem

sudo cp /etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem \
  services/coturn/certs/fullchain.pem
sudo cp /etc/letsencrypt/live/turn.yourdomain.com/privkey.pem \
  services/coturn/certs/privkey.pem

# Set permissions
sudo chown -R $USER:$USER services/asterisk/keys services/coturn/certs
chmod 600 services/asterisk/keys/*.pem services/coturn/certs/*.pem
```

**Option B: Self-Signed (Testing Only)**

```bash
# Create directories
mkdir -p services/asterisk/keys services/coturn/certs

# Generate self-signed certs (valid for 365 days)
openssl req -x509 -newkey rsa:4096 -keyout services/asterisk/keys/privkey.pem \
  -out services/asterisk/keys/fullchain.pem -days 365 -nodes \
  -subj "/CN=pbx.yourdomain.com"

openssl req -x509 -newkey rsa:4096 -keyout services/coturn/certs/privkey.pem \
  -out services/coturn/certs/fullchain.pem -days 365 -nodes \
  -subj "/CN=turn.yourdomain.com"
```

### Step 7: Configure Firewall

```bash
# Install UFW (if not installed)
sudo apt install ufw -y

# Allow SSH
sudo ufw allow 22/tcp

# Asterisk/SIP
sudo ufw allow 5060/udp    # SIP signaling
sudo ufw allow 8089/tcp    # WebRTC (WSS)
sudo ufw allow 8088/tcp    # ARI (Asterisk REST Interface)

# RTP Media (voice)
sudo ufw allow 10000:20000/udp

# Coturn (TURN/STUN)
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/tcp    # TURN over TLS

# Comms API
sudo ufw allow 4000/tcp    # REST API / WebSocket

# SMTP (inbound email)
sudo ufw allow 25/tcp

# Enable firewall
sudo ufw --force enable

# Verify rules
sudo ufw status verbose
```

### Step 8: Deploy the Stack

```bash
cd /home/user/lovable-comm

# Build and start all services
docker compose up --build -d

# Watch logs (wait for all services to start)
docker compose logs -f

# Press Ctrl+C to stop watching logs
```

**Expected output:**
```
✔ Container lovable-comm-postgres-1     Started
✔ Container lovable-comm-redis-1        Started
✔ Container lovable-comm-asterisk-1     Started
✔ Container lovable-comm-coturn-1       Started
✔ Container lovable-comm-comms-api-1    Started
```

### Step 9: Verify Services

```bash
# Check all containers are running
docker compose ps

# Should show all services as "Up"
```

**Test each service:**

```bash
# 1. Test Asterisk WebRTC (WSS)
openssl s_client -connect pbx.yourdomain.com:8089 -servername pbx.yourdomain.com
# Should connect successfully

# 2. Test Asterisk ARI (HTTP)
curl -u ariuser:AriPass456! http://localhost:8088/ari/asterisk/info
# Should return JSON with Asterisk version

# 3. Test Coturn (TURN)
turnutils_uclient -v -u turnuser -w TurnSecret789! turn.yourdomain.com
# (Install turn-client: sudo apt install coturn-utils)

# 4. Test Comms API
curl http://localhost:4000/health
# Should return: {"status":"ok"}

# 5. Test SMTP inbound
telnet localhost 25
# Type: EHLO test.com
# Should respond with SMTP greeting
```

### Step 10: Configure SIP Trunk Provider

**For Bandwidth.com:**
1. Log in to Bandwidth Dashboard
2. Go to Voice → SIP Trunks → Create New
3. Set **Termination URI**: `sip:YOUR_PUBLIC_IP:5060`
4. Set **Authentication**: IP-based or username/password (match `.env`)
5. Add your DID to the trunk
6. Set **Inbound Settings**: Forward to `sip:YOUR_PUBLIC_IP:5060`

**For Telnyx:**
1. Log in to Telnyx Portal
2. Go to Elastic SIP → Create SIP Connection
3. Set **Tech Prefix**: (optional)
4. Add **Outbound Termination**: Your server IP
5. Add **Inbound Routing**: Point your DID to the SIP connection
6. Enable **Authentication** (use credentials from `.env`)

**For Twilio Elastic SIP:**
1. Log in to Twilio Console
2. Go to Elastic SIP Trunking → Create New Trunk
3. Set **Origination URI**: `sip:YOUR_PUBLIC_IP:5060`
4. Add **Credential List** (use credentials from `.env`)
5. Assign your Twilio phone number to the trunk

### Step 11: Configure SMPP Provider

**Contact your SMPP provider and provide:**
- **Bind Type**: Transceiver (TX+RX)
- **Your Server IP**: `YOUR_PUBLIC_IP`
- **Bind Port**: Usually 2775 or 2776
- **System ID**: (they provide this)
- **Password**: (they provide this)
- **Source Number**: Your SMS sender number

**Test SMPP connection:**
```bash
# View Comms API logs
docker compose logs -f comms-api | grep -i smpp

# You should see: "SMPP connected" or similar
```

### Step 12: Test End-to-End

**Outbound Call Test:**
```bash
curl -X POST http://localhost:4000/calls/outbound \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "callerId": "+15557654321"
  }'
```

**Outbound SMS Test:**
```bash
curl -X POST http://localhost:4000/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "body": "Test message from self-hosted stack"
  }'
```

**Inbound Test:**
- Call your DID from your mobile phone
- Watch logs: `docker compose logs -f comms-api`
- You should see `call.inbound` event

---

## Troubleshooting

### Asterisk won't start
```bash
# Check logs
docker compose logs asterisk

# Common issue: cert permissions
sudo chown -R 999:999 services/asterisk/keys
docker compose restart asterisk
```

### WebRTC connection fails
```bash
# Verify TLS certificate
openssl s_client -connect pbx.yourdomain.com:8089

# Check if port 8089 is reachable from outside
# Use: https://www.yougetsignal.com/tools/open-ports/
```

### SIP trunk not registering
```bash
# Check Asterisk SIP debug
docker compose exec asterisk asterisk -rx "pjsip show registrations"
docker compose exec asterisk asterisk -rx "pjsip show endpoints"

# Enable verbose logging
docker compose exec asterisk asterisk -rx "core set verbose 5"
```

### SMPP won't connect
```bash
# Check if provider allows your IP
# Check bind credentials in .env
# View detailed logs
docker compose logs comms-api | grep -A 10 -B 10 smpp
```

### Can't receive inbound calls
```bash
# Verify your provider has routed the DID correctly
# Check Asterisk dialplan
docker compose exec asterisk asterisk -rx "dialplan show"

# Watch for incoming INVITEs
docker compose logs -f asterisk | grep INVITE
```

---

## Phase 1 Completion Checklist

- [ ] VPS provisioned with Docker
- [ ] DNS records configured
- [ ] `.env` file configured with all credentials
- [ ] TLS certificates generated and placed correctly
- [ ] Firewall rules configured (UFW)
- [ ] All Docker containers running (`docker compose ps`)
- [ ] Asterisk WebRTC (WSS) accessible on port 8089
- [ ] Coturn (TURN) accessible on port 5349
- [ ] Comms API health check returns `{"status":"ok"}`
- [ ] SIP trunk provider configured and connected
- [ ] SMPP provider configured and connected
- [ ] Outbound call test successful
- [ ] Outbound SMS test successful
- [ ] Inbound call test successful (call your DID)

---

## Next Steps

Once Phase 1 is complete, proceed to:
- **Phase 2**: Frontend Integration (Lovable components)
- **Phase 3**: Testing & Validation
- **Phase 4**: Gradual Rollout

---

## Support Resources

- **Asterisk Docs**: https://docs.asterisk.org
- **Docker Compose Docs**: https://docs.docker.com/compose/
- **Let's Encrypt**: https://letsencrypt.org/docs/
- **SIP.js**: https://sipjs.com/guides/
- **SMPP Protocol**: https://smpp.org

## Estimated Time
- **First-time setup**: 4-6 hours
- **With experience**: 1-2 hours

## Monthly Infrastructure Cost Estimate
- VPS (4GB): $24/month
- SIP Trunk: $5/month + per-minute ($0.005-0.02/min)
- SMPP: $50/month + per-SMS ($0.003-0.01/SMS)
- Domain: $12/year (~$1/month)
- **Total**: ~$80-100/month base + usage

Compare to current Telnyx/Twilio bills to determine ROI.
