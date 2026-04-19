#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

if [[ ! -f "${ENV_FILE}" ]]; then
  JWT_SECRET="$(generate_secret)"
  API_KEY_HMAC_SECRET="$(generate_secret)"
  NEXTAUTH_SECRET="$(generate_secret)"
  SUPER_ADMIN_KEY="$(generate_secret)"
  ADMIN_PASSWORD="$(generate_secret | cut -c1-20)"

  cat > "${ENV_FILE}" <<EOF
NODE_ENV=development
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/ghostlayer?retryWrites=true&w=majority
SUPER_ADMIN_USERNAME=admin@example.com
SUPER_ADMIN_PASSWORD=${ADMIN_PASSWORD}
JWT_SECRET=${JWT_SECRET}
SUPER_ADMIN_KEY=${SUPER_ADMIN_KEY}
API_KEY_HMAC_SECRET=${API_KEY_HMAC_SECRET}
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
EOF

  echo "[setup] Created .env.local with safe defaults at ${ENV_FILE}"
else
  echo "[setup] .env.local already exists at ${ENV_FILE}"
fi

echo "MongoDB Atlas URI format:"
echo "mongodb+srv://<username>:<password>@<cluster>.mongodb.net/ghostlayer?retryWrites=true&w=majority"
echo "Get a free Atlas cluster: https://www.mongodb.com/cloud/atlas/register"
echo "Edit MONGODB_URI in .env.local then restart"
