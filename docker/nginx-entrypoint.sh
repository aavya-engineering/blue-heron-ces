#!/bin/sh
set -e

SSL_DIR="/etc/nginx/ssl"
CERT_FILE="${SSL_DIR}/cert.pem"
KEY_FILE="${SSL_DIR}/key.pem"
DOMAIN="${SSLIP_DOMAIN:-127.0.0.1.sslip.io}"

mkdir -p "${SSL_DIR}"

# If certificate or key doesn't exist, automatically generate a valid SAN SSL certificate for sslip.io
if [ ! -f "${CERT_FILE}" ] || [ ! -f "${KEY_FILE}" ]; then
    echo "=== [muster-ui] Generating SSL Certificate for sslip.io ==="
    echo "Target Domain: ${DOMAIN} (and *.sslip.io, localhost, 127.0.0.1)"

    SAN_LIST="DNS:${DOMAIN},DNS:*.sslip.io,DNS:127.0.0.1.sslip.io,DNS:localhost,IP:127.0.0.1"

    # Add custom host IP if detectable or specified
    if [ -n "${HOST_IP}" ]; then
        SAN_LIST="${SAN_LIST},DNS:${HOST_IP}.sslip.io,IP:${HOST_IP}"
    fi

    # Create OpenSSL configuration for Subject Alternative Name (SAN)
    cat > /tmp/openssl.cnf <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = US
ST = Virginia
L = Arlington
O = Blue Heron Defense
OU = CES Platform
CN = ${DOMAIN}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${SAN_LIST}
EOF

    openssl req -x509 -nodes -days 825 -newkey rsa:2048 \
        -keyout "${KEY_FILE}" \
        -out "${CERT_FILE}" \
        -config /tmp/openssl.cnf

    rm -f /tmp/openssl.cnf
    echo "-> Generated SSL Certificate with SANs: ${SAN_LIST}"
else
    echo "=== [muster-ui] Using existing SSL Certificate at ${CERT_FILE} ==="
fi

echo "Starting Nginx with SSL on port 443 and HTTP on port 80..."
exec "$@"
