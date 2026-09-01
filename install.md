# 1. Docker + Compose v2 (plugin)
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version

# 2. Node.js 20 + npm
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v && npm -v

# 3. Go 1.23+
wget https://go.dev/dl/go1.23.6.linux-amd64.tar.gz
rm -rf /usr/local/go && tar -C /usr/local -xzf go1.23.6.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc; export PATH=$PATH:/usr/local/go/bin
go version

ufw allow 80,443/tcp && ufw deny 8000,8080,30000